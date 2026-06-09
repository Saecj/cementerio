const express = require('express');
const crypto = require('node:crypto');
const db = require('../../infrastructure/db');
const { requireAuth } = require('../../middleware/auth');
const { normalizeQuery } = require('../../shared/normalize');

function buildReservationsClientRouter() {
	const router = express.Router();

	async function getClientIdOrNull(userId) {
		const clientResult = await db.query('SELECT id FROM clients WHERE user_id = $1 LIMIT 1', [userId]);
		return clientResult.rows[0]?.id ?? null;
	}

	async function reservationsHasReservedDeceasedNameColumn() {
		// Consultamos siempre para evitar quedar “pegados” si una migración se aplica en caliente.
		// Es un query muy barato y el panel/cliente no hace una carga masiva.
		return db
			.query(
				`
					SELECT 1
					FROM information_schema.columns
					WHERE table_schema = 'public'
						AND table_name = 'reservations'
						AND column_name = 'reserved_deceased_full_name'
					LIMIT 1
				`,
			)
			.then((r) => r.rowCount > 0)
			.catch(() => false);
	}

	function generateReservationCode() {
		// Cód. corto y fácil de transcribir (hex en mayúsculas)
		return `RSV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
	}

	// Cliente: crear reserva (queda pending hasta que Admin la habilite)
	router.post('/client/reservations', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) return res.status(403).json({ ok: false, error: 'CLIENT_REQUIRED' });

		const graveId = req.body?.graveId != null ? Number(req.body?.graveId) : null;
		const graveCode = normalizeQuery(req.body?.graveCode);
		const deceasedFullNameRaw = normalizeQuery(req.body?.deceasedFullName);
		const reservedDeceasedFullName = deceasedFullNameRaw || null;
		const reservedFrom = req.body?.reservedFrom || null;
		const reservedTo = req.body?.reservedTo || null;
		if (!Number.isFinite(graveId) && !graveCode) return res.status(400).json({ ok: false, error: 'GRAVE_REQUIRED' });
		if (reservedDeceasedFullName && reservedDeceasedFullName.length > 200) {
			return res.status(400).json({ ok: false, error: 'DECEASED_NAME_TOO_LONG' });
		}

		try {
			const hasReservedName = await reservationsHasReservedDeceasedNameColumn();
			const created = await db.withTransaction(async (client) => {
				const graveResult = graveId
					? await client.query('SELECT id, code, status, is_enabled FROM graves WHERE id = $1 LIMIT 1 FOR UPDATE', [graveId])
					: await client.query('SELECT id, code, status, is_enabled FROM graves WHERE code = $1 LIMIT 1 FOR UPDATE', [graveCode]);
				const grave = graveResult.rows[0];
				if (!grave) {
					const err = new Error('GRAVE_NOT_FOUND');
					err.code = 'GRAVE_NOT_FOUND';
					throw err;
				}
				if (grave.status !== 'available') {
					const err = new Error('GRAVE_NOT_AVAILABLE');
					err.code = 'GRAVE_NOT_AVAILABLE';
					throw err;
				}
				if (grave.is_enabled === false) {
					const err = new Error('GRAVE_DISABLED');
					err.code = 'GRAVE_DISABLED';
					throw err;
				}

				let reservation;
				// Intentos mínimos para evitar colisión de código (muy improbable).
				// Importante: no usamos excepciones para reintentar dentro de una transacción,
				// porque en Postgres eso deja la transacción abortada (25P02).
				for (let i = 0; i < 5; i++) {
					const code = generateReservationCode();
					const result = hasReservedName
						? await client.query(
							`INSERT INTO reservations (client_id, grave_id, reserved_from, reserved_to, status, reservation_code, reserved_deceased_full_name)
							 VALUES ($1, $2, $3, $4, 'pending', $5, $6)
							 ON CONFLICT DO NOTHING
							 RETURNING id, client_id, grave_id, reserved_from, reserved_to, status, reservation_code, reserved_deceased_full_name, created_at`,
							[clientId, grave.id, reservedFrom, reservedTo, code, reservedDeceasedFullName],
						)
						: await client.query(
							`INSERT INTO reservations (client_id, grave_id, reserved_from, reserved_to, status, reservation_code)
							 VALUES ($1, $2, $3, $4, 'pending', $5)
							 ON CONFLICT DO NOTHING
							 RETURNING id, client_id, grave_id, reserved_from, reserved_to, status, reservation_code, created_at`,
							[clientId, grave.id, reservedFrom, reservedTo, code],
						);
					reservation = result.rows[0];
					if (reservation) break;

					// Si no insertó, puede ser colisión de código O que ya exista una reserva activa para la tumba.
					const active = await client.query(
						`SELECT 1
						 FROM reservations
						 WHERE grave_id = $1 AND status IN ('pending','confirmed')
						 LIMIT 1`,
						[grave.id],
					);
					if (active.rowCount > 0) {
						const err = new Error('GRAVE_ALREADY_RESERVED');
						err.code = 'GRAVE_ALREADY_RESERVED';
						throw err;
					}
				}
				if (!reservation) {
					const err = new Error('RESERVATION_CODE_GENERATION_FAILED');
					err.code = 'RESERVATION_CODE_GENERATION_FAILED';
					throw err;
				}
				return reservation;
			});

			return res.status(200).json({ ok: true, reservation: created });
		} catch (e) {
			if (e?.code === 'GRAVE_NOT_FOUND') return res.status(404).json({ ok: false, error: 'GRAVE_NOT_FOUND' });
			if (e?.code === 'GRAVE_NOT_AVAILABLE') return res.status(409).json({ ok: false, error: 'GRAVE_NOT_AVAILABLE' });
			if (e?.code === 'GRAVE_DISABLED') return res.status(409).json({ ok: false, error: 'GRAVE_DISABLED' });
			if (e?.code === 'GRAVE_ALREADY_RESERVED') return res.status(409).json({ ok: false, error: 'GRAVE_ALREADY_RESERVED' });
			throw e;
		}
	});

	// Cliente: resumen de pago de una reserva (para mostrar "te falta pagar" y precargar modal)
	router.get('/client/reservations/payment-summary', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) return res.status(403).json({ ok: false, error: 'CLIENT_REQUIRED' });

		const reservationCode = normalizeQuery(req.query?.reservationCode);
		if (!reservationCode) return res.status(400).json({ ok: false, error: 'RESERVATION_CODE_REQUIRED' });

		const hasReservedName = await reservationsHasReservedDeceasedNameColumn();
		const result = await db.query(
			hasReservedName
				? `
					SELECT
						r.id,
						r.reservation_code,
						r.status AS reservation_status,
						r.reserved_from,
						r.reserved_to,
						g.id AS grave_id,
						g.code AS grave_code,
						g.price_cents,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						COALESCE(r.reserved_deceased_full_name, occ.deceased_full_name) AS deceased_full_name,
						COALESCE(pay.paid_cents, 0) AS paid_cents,
						COALESCE(pay.pending_cents, 0) AS pending_cents,
						GREATEST(COALESCE(g.price_cents, 0) - (COALESCE(pay.paid_cents, 0) + COALESCE(pay.pending_cents, 0)), 0) AS due_cents,
						'PEN' AS currency
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT (d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials b
						JOIN deceased d ON d.id = b.deceased_id
						WHERE b.grave_id = g.id
						ORDER BY b.id DESC
						LIMIT 1
					) occ ON true
					LEFT JOIN (
						SELECT
							p.reservation_id,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'paid') AS paid_cents,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'pending') AS pending_cents
						FROM payments p
						WHERE p.client_id = $1
						GROUP BY p.reservation_id
					) pay ON pay.reservation_id = r.id
					WHERE r.client_id = $1 AND r.reservation_code = $2
					LIMIT 1
				`
				: `
					SELECT
						r.id,
						r.reservation_code,
						r.status AS reservation_status,
						r.reserved_from,
						r.reserved_to,
						g.id AS grave_id,
						g.code AS grave_code,
						g.price_cents,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						occ.deceased_full_name,
						COALESCE(pay.paid_cents, 0) AS paid_cents,
						COALESCE(pay.pending_cents, 0) AS pending_cents,
						GREATEST(COALESCE(g.price_cents, 0) - (COALESCE(pay.paid_cents, 0) + COALESCE(pay.pending_cents, 0)), 0) AS due_cents,
						'PEN' AS currency
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT (d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials b
						JOIN deceased d ON d.id = b.deceased_id
						WHERE b.grave_id = g.id
						ORDER BY b.id DESC
						LIMIT 1
					) occ ON true
					LEFT JOIN (
						SELECT
							p.reservation_id,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'paid') AS paid_cents,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'pending') AS pending_cents
						FROM payments p
						WHERE p.client_id = $1
						GROUP BY p.reservation_id
					) pay ON pay.reservation_id = r.id
					WHERE r.client_id = $1 AND r.reservation_code = $2
					LIMIT 1
				`,
			[clientId, reservationCode],
		);

		const row = result.rows[0];
		if (!row) return res.status(404).json({ ok: false, error: 'RESERVATION_NOT_FOUND' });
		return res.status(200).json({ ok: true, summary: row });
	});

	// Cliente: payload optimizado para mapa 3D/sectorizado
	router.get('/client/cemetery-map', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) {
			return res.status(200).json({ ok: true, sectors: [], graves: [] });
		}

		const hasReservedName = await reservationsHasReservedDeceasedNameColumn();
		const result = await db.query(
			hasReservedName
				? `
					SELECT
						r.id,
						r.reservation_code,
						r.status,
						r.reserved_from,
						r.reserved_to,
						r.created_at,
						g.id AS grave_id,
						g.code AS grave_code,
						g.status AS grave_status,
						g.price_cents,
						g.grave_type_id,
						gt.name AS grave_type_name,
						s.id AS sector_id,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						l.latitude,
						l.longitude,
						r.reserved_deceased_full_name,
						occ.deceased_full_name AS occupied_deceased_full_name,
						(occ.burial_id IS NOT NULL) AS has_burial,
						COALESCE(r.reserved_deceased_full_name, occ.deceased_full_name) AS deceased_full_name
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN grave_types gt ON gt.id = g.grave_type_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT
							bu.id AS burial_id,
							(d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials bu
						JOIN deceased d ON d.id = bu.deceased_id
						WHERE bu.grave_id = g.id
						ORDER BY bu.id DESC
						LIMIT 1
					) occ ON true
					WHERE r.client_id = $1
						AND g.is_enabled IS DISTINCT FROM false
					ORDER BY b.name ASC NULLS LAST, s.name ASC NULLS LAST, l.row_number ASC NULLS LAST, l.col_number ASC NULLS LAST, r.id DESC
					LIMIT 200
				`
				: `
					SELECT
						r.id,
						r.reservation_code,
						r.status,
						r.reserved_from,
						r.reserved_to,
						r.created_at,
						g.id AS grave_id,
						g.code AS grave_code,
						g.status AS grave_status,
						g.price_cents,
						g.grave_type_id,
						gt.name AS grave_type_name,
						s.id AS sector_id,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						l.latitude,
						l.longitude,
						NULL::text AS reserved_deceased_full_name,
						occ.deceased_full_name AS occupied_deceased_full_name,
						(occ.burial_id IS NOT NULL) AS has_burial,
						occ.deceased_full_name
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN grave_types gt ON gt.id = g.grave_type_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT
							bu.id AS burial_id,
							(d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials bu
						JOIN deceased d ON d.id = bu.deceased_id
						WHERE bu.grave_id = g.id
						ORDER BY bu.id DESC
						LIMIT 1
					) occ ON true
					WHERE r.client_id = $1
						AND g.is_enabled IS DISTINCT FROM false
					ORDER BY b.name ASC NULLS LAST, s.name ASC NULLS LAST, l.row_number ASC NULLS LAST, l.col_number ASC NULLS LAST, r.id DESC
					LIMIT 200
				`,
			[clientId],
		);

		const sectorMap = new Map();
		for (const row of result.rows) {
			const id = row.sector_id != null ? String(row.sector_id) : String(row.sector_name || 'general');
			if (!sectorMap.has(id)) {
				sectorMap.set(id, {
					id: row.sector_id ?? null,
					name: row.sector_name || 'Sector general',
					branch_id: row.branch_id ?? null,
					branch_name: row.branch_name || null,
					count: 0,
				});
			}
			sectorMap.get(id).count += 1;
		}

		return res.status(200).json({
			ok: true,
			sectors: Array.from(sectorMap.values()),
			graves: result.rows,
			limit: 200,
		});
	});

	// Cliente/Visitante: ver sus reservas (si corresponde)
	router.get('/client/reservations', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) {
			return res.status(200).json({ ok: true, reservations: [] });
		}

		const hasReservedName = await reservationsHasReservedDeceasedNameColumn();
		const result = await db.query(
			hasReservedName
				? `
					SELECT
						r.id,
						r.reservation_code,
						r.grave_id,
						g.code AS grave_code,
						g.status AS grave_status,
						g.price_cents,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						l.latitude,
						l.longitude,
						r.reserved_deceased_full_name,
						occ.deceased_full_name AS occupied_deceased_full_name,
						(occ.burial_id IS NOT NULL) AS has_burial,
						COALESCE(r.reserved_deceased_full_name, occ.deceased_full_name) AS deceased_full_name,
						COALESCE(pay.paid_cents, 0) AS paid_cents,
						COALESCE(pay.pending_cents, 0) AS pending_cents,
						GREATEST(COALESCE(g.price_cents, 0) - (COALESCE(pay.paid_cents, 0) + COALESCE(pay.pending_cents, 0)), 0) AS due_cents,
						r.reserved_from,
						r.reserved_to,
						r.status,
						r.created_at
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT
							bu.id AS burial_id,
							(d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials bu
						JOIN deceased d ON d.id = bu.deceased_id
						WHERE bu.grave_id = g.id
						ORDER BY bu.id DESC
						LIMIT 1
					) occ ON true
					LEFT JOIN (
						SELECT
							p.reservation_id,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'paid') AS paid_cents,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'pending') AS pending_cents
						FROM payments p
						WHERE p.client_id = $1
						GROUP BY p.reservation_id
					) pay ON pay.reservation_id = r.id
					WHERE r.client_id = $1
					ORDER BY r.id DESC
					LIMIT 200
				`
				: `
					SELECT
						r.id,
						r.reservation_code,
						r.grave_id,
						g.code AS grave_code,
						g.status AS grave_status,
						g.price_cents,
						s.branch_id AS branch_id,
						b.name AS branch_name,
						s.name AS sector_name,
						l.row_number,
						l.col_number,
						l.latitude,
						l.longitude,
						NULL::text AS reserved_deceased_full_name,
						occ.deceased_full_name AS occupied_deceased_full_name,
						(occ.burial_id IS NOT NULL) AS has_burial,
						occ.deceased_full_name,
						COALESCE(pay.paid_cents, 0) AS paid_cents,
						COALESCE(pay.pending_cents, 0) AS pending_cents,
						GREATEST(COALESCE(g.price_cents, 0) - (COALESCE(pay.paid_cents, 0) + COALESCE(pay.pending_cents, 0)), 0) AS due_cents,
						r.reserved_from,
						r.reserved_to,
						r.status,
						r.created_at
					FROM reservations r
					JOIN graves g ON g.id = r.grave_id
					LEFT JOIN locations l ON l.id = g.location_id
					LEFT JOIN sectors s ON s.id = l.sector_id
					LEFT JOIN branches b ON b.id = s.branch_id
					LEFT JOIN LATERAL (
						SELECT
							bu.id AS burial_id,
							(d.last_name || ' ' || d.first_name) AS deceased_full_name
						FROM burials bu
						JOIN deceased d ON d.id = bu.deceased_id
						WHERE bu.grave_id = g.id
						ORDER BY bu.id DESC
						LIMIT 1
					) occ ON true
					LEFT JOIN (
						SELECT
							p.reservation_id,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'paid') AS paid_cents,
							SUM(p.amount_cents) FILTER (WHERE p.status = 'pending') AS pending_cents
						FROM payments p
						WHERE p.client_id = $1
						GROUP BY p.reservation_id
					) pay ON pay.reservation_id = r.id
					WHERE r.client_id = $1
					ORDER BY r.id DESC
					LIMIT 200
				`,
			[clientId],
		);

		return res.status(200).json({ ok: true, reservations: result.rows });
	});

	// Cliente: cancelar su reserva (solo si está pending)
	// Ej: POST /api/client/reservations/123/cancel
	router.post('/client/reservations/:id/cancel', requireAuth, async (req, res) => {
		const userId = req.session.user.id;
		const clientId = await getClientIdOrNull(userId);
		if (!clientId) return res.status(403).json({ ok: false, error: 'CLIENT_REQUIRED' });

		const id = Number(req.params.id);
		if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: 'ID_INVALID' });

		const result = await db.withTransaction(async (client) => {
			const currentResult = await client.query(
				`SELECT id, status
				 FROM reservations
				 WHERE id = $1 AND client_id = $2
				 FOR UPDATE`,
				[id, clientId],
			);
			const current = currentResult.rows[0];
			if (!current) return { kind: 'not_found' };
			if (current.status !== 'pending') return { kind: 'not_cancellable', status: current.status };

			const updated = await client.query(
				`UPDATE reservations
				 SET status = 'cancelled'
				 WHERE id = $1
				 RETURNING id, reservation_code, client_id, grave_id, reserved_from, reserved_to, status, created_at`,
				[id],
			);
			return { kind: 'ok', reservation: updated.rows[0] };
		});

		if (result.kind === 'not_found') return res.status(404).json({ ok: false, error: 'RESERVATION_NOT_FOUND' });
		if (result.kind === 'not_cancellable') return res.status(409).json({ ok: false, error: 'RESERVATION_NOT_PENDING' });
		return res.status(200).json({ ok: true, reservation: result.reservation });
	});

	return router;
}

module.exports = {
	buildReservationsClientRouter,
};
