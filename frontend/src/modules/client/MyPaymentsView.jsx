import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'

function formatMoney(cents, currency) {
	const amount = Number(cents || 0) / 100
	const cur = currency || 'PEN'
	try {
		return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(amount)
	} catch {
		return `${amount.toFixed(2)} ${cur}`
	}
}

function formatDateTime(value) {
	if (!value) return '—'
	try {
		return new Date(value).toLocaleString()
	} catch {
		return String(value)
	}
}

function prettyStatus(status) {
	if (!status) return '—'
	const s = String(status)
	const map = {
		pending: 'Pendiente',
		paid: 'Pagado',
		void: 'Anulado',
	}
	return map[s] || s
}

function statusPillClass(status) {
	switch (String(status || '')) {
		case 'paid':
			return 'border-[color:var(--az3)] bg-[color:var(--az3)] text-white'
		case 'void':
			return 'border-[color:var(--az1)] bg-[color:var(--az1)] text-white'
		case 'pending':
		default:
			return 'border-[color:var(--accent-border)] bg-[color:var(--accent-bg)] text-[color:var(--text-h)]'
	}
}

function paymentTypeLabel(name) {
	const key = String(name || '').trim()
	if (!key) return '—'
	const map = {
		cash: 'Efectivo',
		card_credit: 'Tarjeta de crédito',
		card_debit: 'Tarjeta de débito',
		card: 'Tarjeta',
	}
	return map[key] || key
}

function detectCardBrand(raw) {
	const digits = String(raw || '').replace(/\D/g, '')
	if (!digits) return ''
	if (digits.startsWith('4')) return 'Visa'
	const first2 = Number(digits.slice(0, 2))
	const first4 = Number(digits.slice(0, 4))
	if (first2 >= 51 && first2 <= 55) return 'Mastercard'
	if (first4 >= 2221 && first4 <= 2720) return 'Mastercard'
	return '—'
}

function cardMaxLength(brand) {
	return 19
}

function isValidCardLength(digits, brand) {
	const len = String(digits || '').replace(/\D/g, '').length
	return len === 16
}

function passesLuhn(raw) {
	const digits = String(raw || '').replace(/\D/g, '')
	if (!digits) return false
	let sum = 0
	let doubleNext = false
	for (let i = digits.length - 1; i >= 0; i--) {
		let n = Number(digits[i])
		if (!Number.isInteger(n)) return false
		if (doubleNext) {
			n *= 2
			if (n > 9) n -= 9
		}
		sum += n
		doubleNext = !doubleNext
	}
	return sum % 10 === 0
}

function formatCardNumberInput(raw) {
	const digits = String(raw || '').replace(/\D/g, '').slice(0, 16)
	return digits.replace(/(.{4})/g, '$1-').replace(/-$/, '')
}

function formatExpiryInput(raw) {
	const digits = String(raw || '').replace(/\D/g, '').slice(0, 4)
	if (digits.length <= 2) return digits
	return `${digits.slice(0, 2)}/${digits.slice(2)}`
}

function isValidCardExpiry(raw, now = new Date()) {
	const digits = String(raw || '').replace(/\D/g, '')
	if (digits.length !== 4) return false
	const month = Number(digits.slice(0, 2))
	const year = 2000 + Number(digits.slice(2))
	if (!Number.isInteger(month) || month < 1 || month > 12) return false
	if (!Number.isInteger(year)) return false
	const currentMonth = now.getMonth() + 1
	const currentYear = now.getFullYear()
	return year > currentYear || (year === currentYear && month >= currentMonth)
}

function cardValidationMessage(number, expiry, cvv) {
	const digits = String(number || '').replace(/\D/g, '')
	const brand = detectCardBrand(digits)
	if (!isValidCardLength(digits, brand)) return 'Revisa el número de tarjeta: debe tener 16 dígitos.'
	if (!passesLuhn(digits)) return 'Revisa el número de tarjeta: parece estar incompleto o mal ingresado.'
	if (!isValidCardExpiry(expiry)) return 'Ingresa una fecha de vencimiento válida en formato MM/AA.'
	if (!/^\d{3}$/.test(String(cvv || ''))) return 'Ingresa el código de seguridad de 3 dígitos.'
	return ''
}

function paymentCreateErrorMessage(code) {
	const map = {
		CARD_NUMBER_LENGTH_INVALID: 'Revisa el número de tarjeta: debe tener 16 dígitos.',
		CARD_NUMBER_LUHN_INVALID: 'Revisa el número de tarjeta: parece estar incompleto o mal ingresado.',
		CARD_EXPIRY_INVALID: 'Ingresa una fecha de vencimiento válida en formato MM/AA.',
		CARD_CVV_INVALID: 'Ingresa el código de seguridad de 3 dígitos.',
	}
	return map[code] || code || 'No se pudo registrar el pago'
}

function solesToCents(input) {
	const raw = String(input || '').trim()
	if (!raw) return NaN
	const normalized = raw.replace(',', '.')
	if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return NaN
	const value = Number(normalized)
	if (!Number.isFinite(value)) return NaN
	return Math.round(value * 100)
}

function centsToSolesText(cents) {
	const n = Number(cents)
	if (!Number.isFinite(n)) return ''
	return (n / 100).toFixed(2)
}

const INSTALLMENT_OPTIONS = [1, 3, 6, 9, 12]

function calculateInstallmentPlan(baseCents, typeName, months) {
	const base = Math.max(Number(baseCents || 0), 0)
	const installmentMonths = INSTALLMENT_OPTIONS.includes(Number(months)) ? Number(months) : 1
	let total = base
	const key = String(typeName || '').trim()
	if (key === 'card_credit') total = Math.round(base * 1.045)
	else if ((key === 'card_debit' || key === 'cash') && installmentMonths > 1) total = base + installmentMonths * 500
	return {
		baseCents: base,
		chargeCents: Math.max(total - base, 0),
		totalCents: total,
		installmentMonths,
		installmentAmountCents: Math.ceil(total / installmentMonths),
	}
}

export function MyPaymentsView({ me, onLogin, intent, onIntentHandled, filterSeed }) {
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [items, setItems] = useState([])
	const [filterQ, setFilterQ] = useState('')

	const [types, setTypes] = useState([])
	const [reservationCode, setReservationCode] = useState('')
	const [paymentTypeId, setPaymentTypeId] = useState('')
	const [amountSoles, setAmountSoles] = useState('')
	const [installmentMonths, setInstallmentMonths] = useState(1)
	const [cardNumber, setCardNumber] = useState('')
	const [cardExpiry, setCardExpiry] = useState('')
	const [cardCvv, setCardCvv] = useState('')
	const [creating, setCreating] = useState(false)
	const [createMsg, setCreateMsg] = useState('')
	const [payOpen, setPayOpen] = useState(false)
	const [summary, setSummary] = useState(null)
	const [summaryLoading, setSummaryLoading] = useState(false)
	const [summaryError, setSummaryError] = useState('')

	const paidTotal = useMemo(() => {
		return items
			.filter((p) => p.status === 'paid')
			.reduce((sum, p) => sum + Number(p.amount_cents || 0), 0)
	}, [items])

	const paymentStats = useMemo(() => {
		return {
			total: items.length,
			paid: items.filter((p) => p.status === 'paid').length,
			pending: items.filter((p) => p.status === 'pending').length,
			voided: items.filter((p) => p.status === 'void').length,
		}
	}, [items])

	useEffect(() => {
		if (!filterSeed?.ts) return
		const nextQ = typeof filterSeed.q === 'string' ? filterSeed.q : ''
		setFilterQ(nextQ)
	}, [filterSeed?.ts])

	const filteredItems = useMemo(() => {
		const raw = String(filterQ || '').trim()
		const q = raw.toLowerCase()
		if (!q) return items

		const wantsPending = q.includes('pendiente')
		const wantsPaid = q.includes('pagado') || q.includes('pagados')
		const match = raw.match(/\bRSV[-\w]+\b/i)
		const rsvCode = match ? match[0].toLowerCase() : ''

		let rows = items
		if (wantsPending && !wantsPaid) rows = rows.filter((p) => p.status === 'pending')
		if (wantsPaid && !wantsPending) rows = rows.filter((p) => p.status === 'paid')
		if (rsvCode) rows = rows.filter((p) => String(p.reservation_code || '').toLowerCase().includes(rsvCode))

		if (!wantsPending && !wantsPaid && !rsvCode) {
			rows = rows.filter((p) => {
				const haystack = [
					p.reservation_code,
					p.grave_code,
					p.payment_type_name,
					p.status,
				]
					.filter((v) => v != null && String(v).trim() !== '')
					.join(' ')
					.toLowerCase()
				return haystack.includes(q)
			})
		}

		return rows
	}, [items, filterQ])

	useEffect(() => {
		let cancelled = false
		async function load() {
			if (!me) return
			setLoading(true)
			setError('')
			try {
				const result = await api('/api/client/payments')
				if (!result.ok) {
					setError(result.data?.error || 'No se pudieron cargar tus pagos')
					setItems([])
					return
				}
				if (!cancelled) setItems(Array.isArray(result.data?.payments) ? result.data.payments : [])
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		load()
		return () => {
			cancelled = true
		}
	}, [me])

	useEffect(() => {
		if (!me) return
		const code = intent?.reservationCode
		if (!code) return
		setCreateMsg('')
		setError('')
		setSummaryError('')
		setReservationCode(String(code))
		setPayOpen(true)
		if (typeof onIntentHandled === 'function') onIntentHandled()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [me, intent?.ts])

	useEffect(() => {
		let cancelled = false
		async function loadTypes() {
			if (!me) return
			const result = await api('/api/payment-types')
			if (!result.ok) return
			const rows = Array.isArray(result.data?.paymentTypes) ? result.data.paymentTypes : []
			if (!cancelled) {
				setTypes(rows)
				if (!paymentTypeId) {
					const cash = rows.find((r) => String(r.name) === 'cash')
					if (cash?.id != null) setPaymentTypeId(String(cash.id))
					else if (rows[0]?.id) setPaymentTypeId(String(rows[0].id))
				}
			}
		}
		loadTypes()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [me])

	async function refresh() {
		if (!me) return
		setLoading(true)
		setError('')
		try {
			const result = await api('/api/client/payments')
			if (!result.ok) {
				setError(result.data?.error || 'No se pudieron cargar tus pagos')
				setItems([])
				return
			}
			setItems(Array.isArray(result.data?.payments) ? result.data.payments : [])
		} finally {
			setLoading(false)
		}
	}

	const cardBrand = useMemo(() => detectCardBrand(cardNumber), [cardNumber])
	const selectedTypeName = useMemo(() => {
		const selected = types.find((t) => String(t.id) === String(paymentTypeId))
		return String(selected?.name || '')
	}, [types, paymentTypeId])
	const isCardPayment = useMemo(() => selectedTypeName.startsWith('card'), [selectedTypeName])
	const cardError = useMemo(() => {
		if (!isCardPayment) return ''
		return cardValidationMessage(cardNumber, cardExpiry, cardCvv)
	}, [isCardPayment, cardNumber, cardExpiry, cardCvv])
	const paymentPlan = useMemo(() => {
		const base = Number(summary?.due_cents || 0)
		if (!(base > 0)) return null
		return calculateInstallmentPlan(base, selectedTypeName, installmentMonths)
	}, [summary?.due_cents, selectedTypeName, installmentMonths])

	useEffect(() => {
		if (paymentPlan?.totalCents > 0) setAmountSoles(centsToSolesText(paymentPlan.totalCents))
	}, [paymentPlan?.totalCents])

	const canCreate = useMemo(() => {
		if (creating) return false
		if (!reservationCode.trim()) return false
		if (!paymentTypeId) return false
		const cents = solesToCents(amountSoles)
		if (!Number.isFinite(cents) || cents <= 0) return false
		if (summary) {
			if (summary.reservation_status !== 'confirmed') return false
			const due = Number(summary.due_cents || 0)
			if (!(due > 0)) return false
			if (!paymentPlan || cents !== paymentPlan.totalCents) return false
		}
		const selectedType = types.find((t) => String(t.id) === String(paymentTypeId))
		const typeName = String(selectedType?.name || '')
		const isCard = typeName.startsWith('card')
		if (isCard) {
			if (cardError) return false
		}
		return true
	}, [creating, reservationCode, paymentTypeId, amountSoles, summary, paymentPlan, types, cardError])

	useEffect(() => {
		if (!payOpen) return
		function onKeyDown(e) {
			if (e.key === 'Escape') setPayOpen(false)
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [payOpen])

	useEffect(() => {
		let cancelled = false
		async function loadSummary() {
			if (!payOpen) return
			const code = reservationCode.trim()
			if (!code) {
				setSummary(null)
				setSummaryError('')
				return
			}
			setSummaryLoading(true)
			setSummaryError('')
			try {
				const result = await api(
					`/api/client/reservations/payment-summary?reservationCode=${encodeURIComponent(code)}`,
				)
				if (cancelled) return
				if (!result.ok) {
					setSummary(null)
					setSummaryError(result.data?.error || 'No se pudo cargar el detalle de la reserva')
					return
				}
				const row = result.data?.summary || null
				setSummary(row)
				const due = Number(row?.due_cents || 0)
				if (due > 0) setAmountSoles(centsToSolesText(calculateInstallmentPlan(due, selectedTypeName, installmentMonths).totalCents))
				else setAmountSoles('')
			} finally {
				if (!cancelled) setSummaryLoading(false)
			}
		}
		loadSummary()
		return () => {
			cancelled = true
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [payOpen, reservationCode, selectedTypeName, installmentMonths])

	async function createPayment(e) {
		e?.preventDefault()
		setCreateMsg('')
		setError('')
		setCreating(true)
		try {
			const cents = solesToCents(amountSoles)
			if (!Number.isFinite(cents) || cents <= 0) {
				setError('Ingresa un monto válido en soles')
				return
			}
			if (summary) {
				const due = Number(summary.due_cents || 0)
				if (Number.isFinite(due) && due > 0 && (!paymentPlan || cents !== paymentPlan.totalCents)) {
					setError('El monto debe coincidir con el total calculado de la cuota')
					return
				}
			}
			if (isCardPayment && cardError) {
				setError(cardError)
				return
			}
			const payload = {
				reservationCode: reservationCode.trim(),
				paymentTypeId: Number(paymentTypeId),
				amountCents: cents,
				installmentMonths: Number(paymentPlan?.installmentMonths || installmentMonths || 1),
				currency: 'PEN',
			}
			if (isCardPayment) {
				payload.cardNumber = cardNumber.replace(/\D/g, '')
				payload.cardExpiry = cardExpiry
				payload.cardCvv = cardCvv
			}
			const result = await api('/api/client/payments', {
				method: 'POST',
				body: JSON.stringify(payload),
			})
			if (!result.ok) {
				setError(paymentCreateErrorMessage(result.data?.error))
				return
			}
			setCreateMsg('Pago registrado. Queda pendiente de validación.')
			setReservationCode('')
			setAmountSoles('')
			setInstallmentMonths(1)
			setCardNumber('')
			setCardExpiry('')
			setCardCvv('')
			setSummary(null)
			setPayOpen(false)
			await refresh()
		} finally {
			setCreating(false)
		}
	}

	if (!me) {
		return (
			<div className="space-y-3">
				<div className="text-sm text-[color:var(--text)]">Inicia sesión para ver tus pagos.</div>
				<button
					onClick={onLogin}
					className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[color:var(--on-accent)]"
				>
					Iniciar sesión
				</button>
			</div>
		)
	}

	return (
		<div className="client-ledger-view">
			<div className="client-ledger-head">
				<div>
					<div className="ui-kicker">Comprobantes</div>
					<h2 className="mt-1 text-lg font-semibold text-[color:var(--text-h)]">Mis pagos</h2>
					<div className="mt-1 text-xs text-[color:var(--muted)]">Gestiona pagos registrados, boletas y validaciones.</div>
				</div>
				<div className="client-ledger-total">
					<small>Total pagado</small>
					<strong>{formatMoney(paidTotal, 'PEN')}</strong>
				</div>
			</div>

			<div className="client-ledger-stats">
				<div><span>{paymentStats.total}</span><small>Total</small></div>
				<div><span>{paymentStats.paid}</span><small>Pagados</small></div>
				<div><span>{paymentStats.pending}</span><small>Pendientes</small></div>
				<div><span>{paymentStats.voided}</span><small>Anulados</small></div>
			</div>

			<div className="client-ledger-toolbar">
				<input
					value={filterQ}
					onChange={(e) => setFilterQ(e.target.value)}
					className="w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
					placeholder="Filtrar por reserva, tumba, tipo o estado"
				/>
				<button
					onClick={() => {
						setCreateMsg('')
						setError('')
						setSummary(null)
						setSummaryError('')
						setPayOpen(true)
					}}
					className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-[color:var(--on-accent)]"
				>
					Registrar pago
				</button>
				<div className="client-ledger-toolbar__count">{filteredItems.length} visibles</div>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				{createMsg && <div className="text-sm text-[color:var(--text)]">{createMsg}</div>}
			</div>

			{loading && <div className="text-sm text-[color:var(--text)]">Cargando…</div>}
			{error && <div className="text-sm text-red-600">{error}</div>}

			{!loading && !error && items.length === 0 && (
				<div className="text-sm text-[color:var(--text)]">No tienes pagos registrados.</div>
			)}

			{!loading && !error && items.length > 0 && filteredItems.length === 0 && (
				<div className="text-sm text-[color:var(--text)]">Sin resultados.</div>
			)}

			{filteredItems.length > 0 && (
				<div className="client-ledger-table overflow-x-auto">
					<table className="min-w-full text-left text-sm">
						<thead className="bg-[color:var(--surface-2)] text-xs text-[color:var(--muted)]">
							<tr>
								<th className="px-3 py-2 font-medium">ID</th>
								<th className="px-3 py-2 font-medium">Boleta</th>
								<th className="px-3 py-2 font-medium">Reserva</th>
								<th className="px-3 py-2 font-medium">Tumba</th>
									<th className="px-3 py-2 font-medium">Tipo</th>
									<th className="px-3 py-2 font-medium">Cuotas</th>
									<th className="px-3 py-2 font-medium">Monto</th>
								<th className="px-3 py-2 font-medium">Estado</th>
								<th className="px-3 py-2 font-medium">Fecha</th>
							</tr>
						</thead>
						<tbody>
							{filteredItems.map((p) => (
								<tr key={p.id} className="border-t border-[color:var(--border)] hover:bg-[color:var(--hover)]">
									<td className="px-3 py-2 text-[color:var(--text)]">{p.id}</td>
									<td className="px-3 py-2 text-[color:var(--text)]">
										<a
											href={`/api/client/payments/${p.id}/receipt.pdf`}
											target="_blank"
											rel="noreferrer"
											className="inline-flex items-center justify-center whitespace-nowrap rounded-md bg-red-600 px-2 py-1 text-xs font-semibold !text-white no-underline shadow-[var(--shadow)] ring-1 ring-red-700 hover:bg-red-700 hover:!text-white"
											aria-label="Descargar boleta"
										>
											Descargar boleta
										</a>
										{p.receipt_code ? (
											<div className="mt-1">
												<span className="inline-flex items-center rounded-full bg-[color:var(--accent-bg)] px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[color:var(--text-h)] ring-1 ring-[color:var(--accent-border)]">
													{p.receipt_code}
												</span>
											</div>
										) : null}
									</td>
									<td className="px-3 py-2 text-[color:var(--text)]"><span className="client-code-pill">{p.reservation_code || '—'}</span></td>
									<td className="px-3 py-2 text-[color:var(--text)]"><span className="font-semibold text-[color:var(--text-h)]">{p.grave_code || '—'}</span></td>
									<td className="px-3 py-2 text-[color:var(--text)]">{paymentTypeLabel(p.payment_type_name)}</td>
									<td className="px-3 py-2 text-[color:var(--text)]">
										{Number(p.installment_months || 1) > 1
											? `${p.installment_months} x ${formatMoney(p.installment_amount_cents || 0, p.currency)}`
											: 'Contado'}
									</td>
									<td className="px-3 py-2 text-[color:var(--text)]"><span className="font-semibold text-[color:var(--text-h)]">{formatMoney(p.amount_cents, p.currency)}</span></td>
									<td className="px-3 py-2 text-[color:var(--text)]">
										<span
											className={
												'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ' +
												statusPillClass(p.status)
											}
										>
											{prettyStatus(p.status)}
										</span>
									</td>
									<td className="px-3 py-2 text-[color:var(--text)]">{formatDateTime(p.paid_at || p.created_at)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{payOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-4"
					role="dialog"
					aria-modal="true"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) {
							setPayOpen(false)
							setSummary(null)
							setSummaryError('')
						}
					}}
				>
					<div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
					<div className="relative w-full max-w-lg rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] p-4">
						<div className="flex items-center justify-between gap-2">
							<div className="text-sm font-semibold text-[color:var(--text-h)]">Registrar pago</div>
							<button
								onClick={() => {
								setPayOpen(false)
								setSummary(null)
								setSummaryError('')
							}}
								className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs text-[color:var(--text-h)] hover:bg-[color:var(--hover)]"
							>
								Cerrar
							</button>
						</div>
						<div className="mt-2 text-xs text-[color:var(--text)]">
							Usa el <span className="font-medium text-[color:var(--text-h)]">código de reserva</span>. Solo puedes pagar cuando la reserva esté confirmada por el administrador.
						</div>

						{summaryLoading && <div className="mt-3 text-sm text-[color:var(--text)]">Cargando detalle…</div>}
						{summaryError && <div className="mt-3 text-sm text-red-600">{summaryError}</div>}
						{summary && (
							<div className="mt-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-sm">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="text-xs text-[color:var(--text)]">Reserva</div>
									<div className="text-xs font-medium text-[color:var(--text-h)]">{summary.reservation_code}</div>
								</div>
								<div className="mt-2 grid gap-2 md:grid-cols-2">
									<div className="text-xs text-[color:var(--text)]">
										Estado: <span className="font-medium text-[color:var(--text-h)]">{summary.reservation_status}</span>
									</div>
									<div className="text-xs text-[color:var(--text)]">
										Tumba: <span className="font-medium text-[color:var(--text-h)]">{summary.grave_code || '—'}</span>
									</div>
									<div className="text-xs text-[color:var(--text)]">
										Precio: <span className="font-medium text-[color:var(--text-h)]">{formatMoney(summary.price_cents, summary.currency)}</span>
									</div>
									<div className="text-xs text-[color:var(--text)]">
										Pagado: <span className="font-medium text-[color:var(--text-h)]">{formatMoney(summary.paid_cents, summary.currency)}</span>
									</div>
									<div className="text-xs text-[color:var(--text)]">
										Pendiente validación: <span className="font-medium text-[color:var(--text-h)]">{formatMoney(summary.pending_cents, summary.currency)}</span>
									</div>
									<div className="text-xs text-[color:var(--text)]">
										Te falta pagar:{' '}
										<span className="font-semibold text-[color:var(--text-h)]">{formatMoney(summary.due_cents, summary.currency)}</span>
									</div>
								</div>
								{summary.deceased_full_name ? (
									<div className="mt-2 text-xs text-[color:var(--text)]">
										Difunto: <span className="font-medium text-[color:var(--text-h)]">{summary.deceased_full_name}</span>
									</div>
								) : null}
								{summary.reservation_status !== 'confirmed' && (
									<div className="mt-2 text-xs text-red-600">Esta reserva aún no está confirmada, no puedes pagar todavía.</div>
								)}
							</div>
						)}

						<form onSubmit={createPayment} className="mt-3 space-y-2">
							<div>
								<label className="block text-xs text-[color:var(--text)]">Código de reserva</label>
								<input
									value={reservationCode}
									onChange={(e) => setReservationCode(e.target.value)}
									className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
									placeholder="Ej: RSV-1A2B3C4D"
								/>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<div>
									<label className="block text-xs text-[color:var(--text)]">Tipo de pago</label>
									<select
										value={paymentTypeId}
										onChange={(e) => {
											setPaymentTypeId(e.target.value)
											setError('')
											setCreateMsg('')
											setCardNumber('')
											setCardExpiry('')
											setCardCvv('')
											setInstallmentMonths(1)
										}}
										className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
									>
										{types.length === 0 ? (
											<option value="">Sin tipos</option>
										) : (
											types.map((t) => (
												<option key={t.id} value={String(t.id)}>
													{paymentTypeLabel(t.name)}
												</option>
											))
										)}
									</select>
								</div>
								<div>
									<label className="block text-xs text-[color:var(--text)]">Cuotas</label>
									<select
										value={String(installmentMonths)}
										onChange={(e) => {
											setInstallmentMonths(Number(e.target.value))
											setError('')
											setCreateMsg('')
										}}
										className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
									>
										{INSTALLMENT_OPTIONS.map((m) => (
											<option key={m} value={String(m)}>
												{m === 1 ? 'Contado' : `${m} meses`}
											</option>
										))}
									</select>
								</div>
							</div>
							<div className="grid gap-2 md:grid-cols-2">
								<div>
									<label className="block text-xs text-[color:var(--text)]">Monto (S/)</label>
									<input
										type="text"
										inputMode="decimal"
										value={amountSoles}
										onChange={(e) => {
											const next = e.target.value
											// Acepta solo dígitos y hasta 2 decimales.
											if (next === '' || /^\d*(?:[.,]\d{0,2})?$/.test(next)) setAmountSoles(next)
										}}
										readOnly={Boolean(summary && Number(summary.due_cents || 0) > 0)}
										className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
										placeholder="Ej: 198.00"
									/>
								</div>
							</div>

							{paymentPlan ? (
								<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-xs text-[color:var(--text)]">
									<div className="grid gap-2 sm:grid-cols-3">
										<div>
											<div className="ui-kicker">Base</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">{formatMoney(paymentPlan.baseCents, summary?.currency)}</div>
										</div>
										<div>
											<div className="ui-kicker">Recargo</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">{formatMoney(paymentPlan.chargeCents, summary?.currency)}</div>
										</div>
										<div>
											<div className="ui-kicker">Cuota</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">
												{paymentPlan.installmentMonths} x {formatMoney(paymentPlan.installmentAmountCents, summary?.currency)}
											</div>
										</div>
									</div>
									<div className="mt-2 border-t border-[color:var(--border)] pt-2 font-semibold text-[color:var(--text-h)]">
										Total a registrar: {formatMoney(paymentPlan.totalCents, summary?.currency)}
									</div>
								</div>
							) : null}

							{isCardPayment ? (
								<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3">
									<div>
										<label className="block text-xs text-[color:var(--text)]">Número de tarjeta</label>
										<input
											value={cardNumber}
											onChange={(e) => {
												setCardNumber(formatCardNumberInput(e.target.value))
											}}
											className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-h)]"
											placeholder="Ej: 4111111111111111"
											inputMode="numeric"
											autoComplete="cc-number"
											maxLength={cardMaxLength(cardBrand)}
										/>
									</div>
									<div className="mt-2 grid gap-2 sm:grid-cols-2">
										<div>
											<label className="block text-xs text-[color:var(--text)]">Vencimiento</label>
											<input
												value={cardExpiry}
												onChange={(e) => setCardExpiry(formatExpiryInput(e.target.value))}
												className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-h)]"
												placeholder="MM/AA"
												inputMode="numeric"
												autoComplete="cc-exp"
												maxLength={5}
											/>
										</div>
										<div>
											<label className="block text-xs text-[color:var(--text)]">CVV</label>
											<input
												value={cardCvv}
												onChange={(e) => setCardCvv(String(e.target.value || '').replace(/\D/g, '').slice(0, 3))}
												className="mt-1 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text-h)]"
												placeholder="3 dígitos"
												inputMode="numeric"
												autoComplete="cc-csc"
												maxLength={3}
											/>
										</div>
									</div>
									<div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text)]">
										<span>
											Marca:{' '}
											<span className="font-medium text-[color:var(--text-h)]">{cardBrand || '—'}</span>
										</span>
										<span>No se almacenan datos de tarjeta.</span>
									</div>
									{cardError ? <div className="mt-2 text-xs text-red-600">{cardError}</div> : null}
								</div>
							) : null}

							<button
								disabled={!canCreate}
								className="w-full rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-50"
							>
								{creating ? 'Registrando…' : 'Registrar pago'}
							</button>
						</form>
					</div>
				</div>
			)}
		</div>
	)
}
