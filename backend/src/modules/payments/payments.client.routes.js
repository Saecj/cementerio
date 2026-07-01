const express = require('express');
const db = require('../../infrastructure/db');
const { requireAuth } = require('../../middleware/auth');
const { normalizeQuery } = require('../../shared/normalize');
const { writePaymentReceiptPdf } = require('../../shared/payment-receipt-pdf');

const INSTALLMENT_MONTHS = new Set([1, 3, 6, 9, 12]);

function normalizeInstallmentMonths(value) {
	const n = Number(value || 1);
	if (!Number.isFinite(n)) return 1;
	const rounded = Math.trunc(n);
	return INSTALLMENT_MONTHS.has(rounded) ? rounded : 1;
}

function calculateInstallmentPlan(baseCents, paymentTypeName, installmentMonths) {
	const base = Math.max(Number(baseCents || 0), 0);
	const months = normalizeInstallmentMonths(installmentMonths);
	const typeName = String(paymentTypeName || '').trim();
	let total = base;

	if (typeName === 'card_credit') {
		total = Math.round(base * 1.045);
	} else if ((typeName === 'card_debit' || typeName === 'cash') && months > 1) {
		total = base + months * 500;
	}

	return {
		baseAmountCents: base,
		financeChargeCents: Math.max(total - base, 0),
		installmentMonths: months,
		installmentAmountCents: Math.ceil(total / months),
		totalCents: total,
	};
}

function detectCardBrand(raw) {
	const digits = String(raw || '').replace(/\D/g, '');
	if (!digits) return '';
	if (digits.startsWith('4')) return 'Visa';
	const first2 = Number(digits.slice(0, 2));
	const first4 = Number(digits.slice(0, 4));
	if (first2 >= 51 && first2 <= 55) return 'Mastercard';
	if (first4 >= 2221 && first4 <= 2720) return 'Mastercard';
	return '';
}

function isValidCardLength(raw, brand) {
	const len = String(raw || '').replace(/\D/g, '').length;
	return len === 16;
}

function passesLuhn(raw) {
	const digits = String(raw || '').replace(/\D/g, '');
	if (!digits) return false;
	let sum = 0;
	let doubleNext = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let n = Number(digits[i]);
		if (!Number.isInteger(n)) return false;
		if (doubleNext) {
			n *= 2;
			if (n > 9) n -= 9;
		}
		sum += n;
		doubleNext = !doubleNext;
	}
	return sum % 10 === 0;
}

function isValidCardExpiry(raw, now = new Date()) {
	const digits = String(raw || '').replace(/\D/g, '');
	if (digits.length !== 4 && digits.length !== 6) return false;
	const month = Number(digits.slice(0, 2));
	const yearDigits = digits.slice(2);
	const year = yearDigits.length === 2 ? 2000 + Number(yearDigits) : Number(yearDigits);
	if (!Number.isInteger(month) || month < 1 || month > 12) return false;
	if (!Number.isInteger(year)) return false;
	const currentMonth = now.getMonth() + 1;
	const currentYear = now.getFullYear();
	return year > currentYear || (year === currentYear && month >= currentMonth);
}

function validateCardPayload(paymentTypeName, body) {
	const typeName = String(paymentTypeName || '').trim();
	if (!typeName.startsWith('card')) return null;
	const cardNumber = String(body?.cardNumber || '').replace(/\D/g, '');
	const brand = detectCardBrand(cardNumber);
	if (!isValidCardLength(cardNumber, brand)) return 'CARD_NUMBER_LENGTH_INVALID';
	if (!passesLuhn(cardNumber)) return 'CARD_NUMBER_LUHN_INVALID';
	if (!isValidCardExpiry(body?.cardExpiry)) return 'CARD_EXPIRY_INVALID';
	if (!/^\d{3}$/.test(String(body?.cardCvv || ''))) return 'CARD_CVV_INVALID';
	return null;
}

function buildPaymentsClientRouter() {
	const router = express.Router();

	async function getClientIdOrNull(userId) {
		const clientResult = await db.query('SELECT id FROM clients WHERE user_id = $1 LIMIT 1', [userId]);
		return clientResult.rows[0]?.id ?? null;
	}

	// Cliente/Visitante: ver sus pagos (si corresponde)
	router.get('/client/payments', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) {
			return res.status(200).json({ ok: true, payments: [] });
		}

		const result = await db.query(
			`
				SELECT
					p.id,
					p.receipt_code,
					p.reservation_id,
					r.reservation_code,
					r.grave_id,
					g.code AS grave_code,
					p.payment_type_id,
					pt.name AS payment_type_name,
					p.base_amount_cents,
					p.finance_charge_cents,
					p.installment_months,
					p.installment_amount_cents,
					p.amount_cents,
					p.currency,
					p.status,
					p.paid_at,
					p.created_at
				FROM payments p
				JOIN payment_types pt ON pt.id = p.payment_type_id
				LEFT JOIN reservations r ON r.id = p.reservation_id
				LEFT JOIN graves g ON g.id = r.grave_id
				WHERE p.client_id = $1
				ORDER BY p.id DESC
				LIMIT 200
			`,
			[clientId],
		);

		return res.status(200).json({ ok: true, payments: result.rows });
	});

	// Cliente: descargar comprobante PDF
	router.get('/client/payments/:id/receipt.pdf', requireAuth, async (req, res) => {
		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'ID_INVALID' });

		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

		const result = await db.query(
			`
				SELECT
					p.id,
					p.receipt_code,
					p.receipt_issued_at,
					p.client_id,
					p.reservation_id,
					p.amount_cents,
					p.currency,
					p.status,
					p.paid_at,
					p.created_at,
					pt.name AS payment_type_name,
					u.email AS client_email,
					c.full_name AS client_full_name,
					c.document_id AS client_document_id,
					r.reservation_code,
					g.code AS grave_code,
					b.name AS branch_name,
					s.name AS sector_name
				FROM payments p
				JOIN payment_types pt ON pt.id = p.payment_type_id
				JOIN clients c ON c.id = p.client_id
				JOIN users u ON u.id = c.user_id
				LEFT JOIN reservations r ON r.id = p.reservation_id
				LEFT JOIN graves g ON g.id = r.grave_id
				LEFT JOIN locations l ON l.id = g.location_id
				LEFT JOIN sectors s ON s.id = l.sector_id
				LEFT JOIN branches b ON b.id = s.branch_id
				WHERE p.id = $1 AND p.client_id = $2
				LIMIT 1
			`,
			[id, clientId],
		);
		const receipt = result.rows[0];
		if (!receipt) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });

		return writePaymentReceiptPdf(res, receipt);
	});

	// Cliente: registrar un pago (queda pending para validación)
	router.post('/client/payments', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) return res.status(403).json({ ok: false, error: 'CLIENT_REQUIRED' });

		const reservationCode = normalizeQuery(req.body?.reservationCode);
		const paymentTypeId = req.body?.paymentTypeId;
		const amountCents = Number(req.body?.amountCents);
		const currency = normalizeQuery(req.body?.currency) || 'PEN';
		const installmentMonths = normalizeInstallmentMonths(req.body?.installmentMonths);
		if (!reservationCode) return res.status(400).json({ ok: false, error: 'RESERVATION_CODE_REQUIRED' });
		if (!paymentTypeId) return res.status(400).json({ ok: false, error: 'PAYMENT_TYPE_REQUIRED' });
		if (!Number.isFinite(amountCents) || amountCents <= 0) return res.status(400).json({ ok: false, error: 'AMOUNT_INVALID' });

		try {
			const created = await db.withTransaction(async (client) => {
				const resv = await client.query(
					`
						SELECT r.id, r.status, r.grave_id, COALESCE(g.price_cents, 0) AS price_cents
						FROM reservations r
						JOIN graves g ON g.id = r.grave_id
						WHERE r.client_id = $1 AND r.reservation_code = $2
						LIMIT 1
						FOR UPDATE
					`,
					[clientId, reservationCode],
				);
				const reservation = resv.rows[0];
				if (!reservation) {
					const err = new Error('RESERVATION_NOT_FOUND');
					err.code = 'RESERVATION_NOT_FOUND';
					throw err;
				}
				if (reservation.status !== 'confirmed') {
					const err = new Error('RESERVATION_NOT_CONFIRMED');
					err.code = 'RESERVATION_NOT_CONFIRMED';
					throw err;
				}

				const typeResult = await client.query('SELECT id, name FROM payment_types WHERE id = $1 LIMIT 1', [paymentTypeId]);
				const paymentType = typeResult.rows[0];
				if (!paymentType) {
					const err = new Error('PAYMENT_TYPE_NOT_FOUND');
					err.code = 'PAYMENT_TYPE_NOT_FOUND';
					throw err;
				}
				const cardError = validateCardPayload(paymentType.name, req.body);
				if (cardError) {
					const err = new Error(cardError);
					err.code = cardError;
					throw err;
				}

				const sumsResult = await client.query(
					`
						SELECT
							COALESCE(SUM(amount_cents) FILTER (WHERE status = 'paid'), 0) AS paid_cents,
							COALESCE(SUM(amount_cents) FILTER (WHERE status = 'pending'), 0) AS pending_cents
						FROM payments
						WHERE client_id = $1 AND reservation_id = $2
					`,
					[clientId, reservation.id],
				);
				const paidCents = Number(sumsResult.rows[0]?.paid_cents || 0);
				const pendingCents = Number(sumsResult.rows[0]?.pending_cents || 0);
				const priceCents = Number(reservation.price_cents || 0);
				const dueCents = Math.max(priceCents - (paidCents + pendingCents), 0);
				if (!(dueCents > 0)) {
					const err = new Error('NOTHING_DUE');
					err.code = 'NOTHING_DUE';
					throw err;
				}
				const plan = calculateInstallmentPlan(dueCents, paymentType.name, installmentMonths);
				if (amountCents !== plan.totalCents) {
					const err = new Error('AMOUNT_MUST_MATCH_DUE');
					err.code = 'AMOUNT_MUST_MATCH_DUE';
					throw err;
				}

				const inserted = await client.query(
					`INSERT INTO payments (
						client_id,
						reservation_id,
						payment_type_id,
						amount_cents,
						base_amount_cents,
						finance_charge_cents,
						installment_months,
						installment_amount_cents,
						currency,
						status
					)
					 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
					 RETURNING id, receipt_code, client_id, reservation_id, payment_type_id, amount_cents, base_amount_cents, finance_charge_cents, installment_months, installment_amount_cents, currency, status, paid_at, created_at`,
					[
						clientId,
						reservation.id,
						paymentTypeId,
						plan.totalCents,
						plan.baseAmountCents,
						plan.financeChargeCents,
						plan.installmentMonths,
						plan.installmentAmountCents,
						currency,
					],
				);
				return inserted.rows[0];
			});

			return res.status(200).json({ ok: true, payment: created });
		} catch (error) {
			const code = error?.code || error?.message;
			if (code === 'RESERVATION_NOT_FOUND') return res.status(404).json({ ok: false, error: code });
			if (code === 'RESERVATION_NOT_CONFIRMED') return res.status(409).json({ ok: false, error: code });
			if (code === 'NOTHING_DUE') return res.status(409).json({ ok: false, error: code });
			if (code === 'PAYMENT_TYPE_NOT_FOUND') return res.status(400).json({ ok: false, error: code });
			if (code === 'AMOUNT_MUST_MATCH_DUE') return res.status(400).json({ ok: false, error: code });
			if (
				code === 'CARD_NUMBER_LENGTH_INVALID' ||
				code === 'CARD_NUMBER_LUHN_INVALID' ||
				code === 'CARD_EXPIRY_INVALID' ||
				code === 'CARD_CVV_INVALID'
			) {
				return res.status(400).json({ ok: false, error: code });
			}
			console.error('PAYMENT_CREATE_FAILED', error);
			return res.status(500).json({ ok: false, error: 'PAYMENT_CREATE_FAILED' });
		}
	});

	return router;
}

module.exports = {
	buildPaymentsClientRouter,
};
