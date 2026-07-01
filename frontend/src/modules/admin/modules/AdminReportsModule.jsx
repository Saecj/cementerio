import { useEffect, useMemo, useState } from 'react'
import { Card } from '../ui'

export function AdminReportsModule({ reservations, payments, onRefresh }) {
	function formatMoney(cents, currency = 'PEN') {
		const amount = Number(cents || 0) / 100
		try {
			return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)
		} catch {
			return `S/ ${amount.toFixed(2)}`
		}
	}

	function normalizeWhatsAppPhone(phone) {
		const digits = String(phone || '').replace(/\D/g, '')
		if (!digits) return ''
		if (digits.startsWith('51')) return digits
		if (digits.length === 9) return `51${digits}`
		return digits
	}

	function whatsappUrl(row) {
		const phone = normalizeWhatsAppPhone(row?.client_phone)
		if (!phone) return ''
		const pending = Math.max(Number(row?.price_cents || 0) - Number(row?.paid_cents || 0), 0)
		const message = [
			`Hola ${row?.client_full_name || ''}`.trim(),
			`te escribimos sobre tu reserva ${row?.reservation_code || ''} de la tumba ${row?.grave_code || ''}.`,
			`Figura como pendiente de pago por ${formatMoney(pending || row?.price_cents || 0)}.`,
			'Por favor, indícanos si deseas regularizarla.',
		].join(' ')
		return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
	}

	function safeStorageGet(key) {
		try {
			return window.localStorage.getItem(key)
		} catch {
			return null
		}
	}
	function safeStorageSet(key, value) {
		try {
			window.localStorage.setItem(key, value)
		} catch {
			// ignore
		}
	}

	function reservationStatusUi(status) {
		switch (status) {
			case 'confirmed':
				return { label: 'Confirmada', className: 'bg-[color:var(--az3)] text-white border-[color:var(--az3)]', dot: 'bg-[color:var(--az3)]' }
			case 'cancelled':
				return { label: 'Cancelada', className: 'bg-[color:var(--az1)] text-white border-[color:var(--az1)]', dot: 'bg-[color:var(--az1)]' }
			case 'expired':
				return { label: 'Expirada', className: 'bg-[color:var(--az1)] text-white border-[color:var(--az1)]', dot: 'bg-[color:var(--az1)]' }
			case 'pending':
			default:
				return { label: 'Pendiente', className: 'bg-[color:var(--surface-2)] text-[color:var(--az2)] border-[color:var(--az4)]', dot: 'bg-[color:var(--az4)]' }
		}
	}
	function paymentStatusUi(status) {
		switch (status) {
			case 'paid':
				return { label: 'Pagado', className: 'bg-[color:var(--az3)] text-white border-[color:var(--az3)]', dot: 'bg-[color:var(--az3)]' }
			case 'void':
				return { label: 'Anulado', className: 'bg-[color:var(--az1)] text-white border-[color:var(--az1)]', dot: 'bg-[color:var(--az1)]' }
			case 'pending':
			default:
				return { label: 'Pendiente', className: 'bg-[color:var(--surface-2)] text-[color:var(--az2)] border-[color:var(--az4)]', dot: 'bg-[color:var(--az4)]' }
		}
	}

	function paymentSummaryUi(status) {
		return paymentStatusUi(status === 'paid' ? 'paid' : 'pending')
	}

	const [refreshing, setRefreshing] = useState(false)

	const rStorageKey = 'ui.admin.reports.reservations.seenMaxId'
	const [rSeenMaxId, setRSeenMaxId] = useState(() => {
		const v = safeStorageGet(rStorageKey)
		const n = v != null ? Number(v) : null
		return Number.isFinite(n) ? n : null
	})
	const rCurrentMaxId = useMemo(() => {
		const ids = reservations.map((r) => Number(r.id)).filter((n) => Number.isFinite(n))
		return ids.length ? Math.max(...ids) : 0
	}, [reservations])
	useEffect(() => {
		if (rSeenMaxId == null && rCurrentMaxId > 0) {
			setRSeenMaxId(rCurrentMaxId)
			safeStorageSet(rStorageKey, String(rCurrentMaxId))
		}
	}, [rCurrentMaxId, rSeenMaxId])
	useEffect(() => {
		if (rSeenMaxId != null) safeStorageSet(rStorageKey, String(rSeenMaxId))
	}, [rSeenMaxId])
	const rNewCount = useMemo(() => {
		if (rSeenMaxId == null) return 0
		return reservations.filter((r) => Number(r.id) > Number(rSeenMaxId)).length
	}, [reservations, rSeenMaxId])

	const pStorageKey = 'ui.admin.reports.payments.seenMaxId'
	const [pSeenMaxId, setPSeenMaxId] = useState(() => {
		const v = safeStorageGet(pStorageKey)
		const n = v != null ? Number(v) : null
		return Number.isFinite(n) ? n : null
	})
	const pCurrentMaxId = useMemo(() => {
		const ids = payments.map((p) => Number(p.id)).filter((n) => Number.isFinite(n))
		return ids.length ? Math.max(...ids) : 0
	}, [payments])
	useEffect(() => {
		if (pSeenMaxId == null && pCurrentMaxId > 0) {
			setPSeenMaxId(pCurrentMaxId)
			safeStorageSet(pStorageKey, String(pCurrentMaxId))
		}
	}, [pCurrentMaxId, pSeenMaxId])
	useEffect(() => {
		if (pSeenMaxId != null) safeStorageSet(pStorageKey, String(pSeenMaxId))
	}, [pSeenMaxId])
	const pNewCount = useMemo(() => {
		if (pSeenMaxId == null) return 0
		return payments.filter((p) => Number(p.id) > Number(pSeenMaxId)).length
	}, [payments, pSeenMaxId])

	async function doRefresh() {
		setRefreshing(true)
		try {
			await onRefresh?.()
		} finally {
			setRefreshing(false)
		}
	}

	return (
		<Card title="Reporte">
			<div className="text-sm text-[color:var(--text)]">Resumen operativo con los últimos movimientos registrados.</div>
			<div className="mt-2 flex items-center justify-end gap-2">
				<button
					type="button"
					onClick={doRefresh}
					disabled={refreshing}
					className="rounded-md border border-[color:var(--border)] px-2 py-1 text-xs text-[color:var(--text-h)] hover:bg-[color:var(--hover)] disabled:opacity-50"
				>
					{refreshing ? 'Actualizando…' : 'Actualizar'}
				</button>
			</div>
			<div className="grid gap-3 md:grid-cols-2">
				<div className="rounded-md border border-[color:var(--border)]">
					<div className="border-b border-[color:var(--border)] px-3 py-2 text-xs font-medium text-[color:var(--text)]">
						<div className="flex items-center justify-between gap-2">
							<span>Reservas</span>
							<div className="flex items-center gap-2">
								{rNewCount > 0 && (
									<span className="rounded-full bg-[color:var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--az2)]">
										Nuevos: {rNewCount}
									</span>
								)}
								<button
									type="button"
									onClick={() => setRSeenMaxId(rCurrentMaxId || null)}
									disabled={reservations.length === 0 || rCurrentMaxId === 0 || rNewCount === 0}
									className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text-h)] hover:bg-[color:var(--hover)] disabled:opacity-50"
								>
									Marcar vistos
								</button>
							</div>
						</div>
					</div>
					<div className="px-3 py-2 text-[11px] text-[color:var(--text)]">
						<div className="flex flex-wrap gap-3">
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${reservationStatusUi('pending').dot}`} />
								Pendiente
							</div>
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${reservationStatusUi('confirmed').dot}`} />
								Confirmada
							</div>
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${reservationStatusUi('cancelled').dot}`} />
								Cancelada/Expirada
							</div>
							<div className="flex items-center gap-2">
								<span className="inline-block h-2 w-2 rounded-full bg-[color:var(--az4)]" style={{ opacity: 0.35 }} />
								Nuevo
							</div>
						</div>
					</div>
					<div className="max-h-[420px] overflow-y-auto md:max-h-[560px]">
						{reservations.length === 0 ? (
							<div className="p-3 text-sm text-[color:var(--text)]">Sin reservas.</div>
						) : (
							reservations.slice(0, 200).map((r) => {
								const paymentUi = paymentSummaryUi(r.payment_status)
								const pendingCents = Math.max(Number(r.price_cents || 0) - Number(r.paid_cents || 0), 0)
								const wa = r.payment_status !== 'paid' ? whatsappUrl(r) : ''
								return (
									<div key={r.id} className="border-b border-[color:var(--border)] p-3 last:border-b-0">
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div>
												<div className="text-sm font-medium text-[color:var(--text-h)]">
													<span className={Number(r.id) > Number(rSeenMaxId || 0) ? 'text-[color:var(--az2)]' : ''}>
														#{r.id} · {r.reservation_code || r.grave_code}
													</span>
													{Number(r.id) > Number(rSeenMaxId || 0) && (
														<span className="ml-2 rounded-full bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--az2)]">
															NUEVO
														</span>
													)}
												</div>
												<div className="mt-1 text-xs text-[color:var(--text)]">
													{r.client_full_name || 'Cliente'} · {r.client_email}
												</div>
												<div className="mt-1 text-xs text-[color:var(--text)]">
													Celular: <span className="font-semibold text-[color:var(--text-h)]">{r.client_phone || 'Sin registrar'}</span>
												</div>
											</div>
											<div className="flex flex-wrap justify-end gap-2">
												<span className={
													'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ' +
													reservationStatusUi(r.status).className
												}
												>
													{reservationStatusUi(r.status).label}
												</span>
												<span className={'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ' + paymentUi.className}>
													Pago: {paymentUi.label}
												</span>
											</div>
										</div>
										<div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
											<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
												<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Tumba</div>
												<div className="mt-1 font-semibold text-[color:var(--text-h)]">{r.grave_code || '—'}</div>
											</div>
											<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
												<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Pendiente</div>
												<div className="mt-1 font-semibold text-[color:var(--text-h)]">{formatMoney(pendingCents)}</div>
											</div>
											<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
												<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Días</div>
												<div className="mt-1 font-semibold text-[color:var(--text-h)]">{Number(r.days_registered || 0)} registrados</div>
											</div>
										</div>
										{wa ? (
											<div className="mt-3 flex justify-end">
												<a
													href={wa}
													target="_blank"
													rel="noreferrer"
													className="inline-flex items-center rounded-md bg-[color:var(--accent)] px-3 py-2 text-xs font-semibold !text-[color:var(--on-accent)] no-underline hover:opacity-90"
												>
													Enviar WhatsApp
												</a>
											</div>
										) : null}
									</div>
								)
							})
						)}
					</div>
				</div>
				<div className="rounded-md border border-[color:var(--border)]">
					<div className="border-b border-[color:var(--border)] px-3 py-2 text-xs font-medium text-[color:var(--text)]">
						<div className="flex items-center justify-between gap-2">
							<span>Pagos</span>
							<div className="flex items-center gap-2">
								{pNewCount > 0 && (
									<span className="rounded-full bg-[color:var(--surface-2)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--az2)]">
										Nuevos: {pNewCount}
									</span>
								)}
								<button
									type="button"
									onClick={() => setPSeenMaxId(pCurrentMaxId || null)}
									disabled={payments.length === 0 || pCurrentMaxId === 0 || pNewCount === 0}
									className="rounded-md border border-[color:var(--border)] px-2 py-0.5 text-[11px] text-[color:var(--text-h)] hover:bg-[color:var(--hover)] disabled:opacity-50"
								>
									Marcar vistos
								</button>
							</div>
						</div>
					</div>
					<div className="px-3 py-2 text-[11px] text-[color:var(--text)]">
						<div className="flex flex-wrap gap-3">
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${paymentStatusUi('pending').dot}`} />
								Pendiente
							</div>
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${paymentStatusUi('paid').dot}`} />
								Pagado
							</div>
							<div className="flex items-center gap-2">
								<span className={`inline-block h-2 w-2 rounded-full ${paymentStatusUi('void').dot}`} />
								Anulado
							</div>
							<div className="flex items-center gap-2">
								<span className="inline-block h-2 w-2 rounded-full bg-[color:var(--az4)]" style={{ opacity: 0.35 }} />
								Nuevo
							</div>
						</div>
					</div>
					<div className="max-h-[420px] overflow-y-auto md:max-h-[560px]">
						{payments.length === 0 ? (
							<div className="p-3 text-sm text-[color:var(--text)]">Sin pagos.</div>
						) : (
							payments.slice(0, 200).map((p) => (
								<div key={p.id} className="border-b border-[color:var(--border)] p-3 last:border-b-0">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div>
											<div className="text-sm font-medium text-[color:var(--text-h)]">
												<span className={Number(p.id) > Number(pSeenMaxId || 0) ? 'text-[color:var(--az2)]' : ''}>
													#{p.id} · {formatMoney(p.amount_cents, p.currency)}
												</span>
												{Number(p.id) > Number(pSeenMaxId || 0) && (
													<span className="ml-2 rounded-full bg-[color:var(--surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--az2)]">
														NUEVO
													</span>
												)}
											</div>
											<div className="mt-1 text-xs text-[color:var(--text)]">
												{p.client_full_name || 'Cliente'} · {p.client_email}
											</div>
											<div className="mt-1 text-xs text-[color:var(--text)]">
												Celular: <span className="font-semibold text-[color:var(--text-h)]">{p.client_phone || 'Sin registrar'}</span>
											</div>
										</div>
										<span className={
											'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] ' +
											paymentStatusUi(p.status).className
										}
										>
											{paymentStatusUi(p.status).label}
										</span>
									</div>
									<div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
										<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
											<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Reserva</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">{p.reservation_code || '—'}</div>
										</div>
										<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
											<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Tipo</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">{p.payment_type_name}</div>
										</div>
										<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)] p-2">
											<div className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--muted)]">Cuotas</div>
											<div className="mt-1 font-semibold text-[color:var(--text-h)]">
												{Number(p.installment_months || 1) > 1
													? `${p.installment_months} x ${formatMoney(p.installment_amount_cents || 0, p.currency)}`
													: 'Contado'}
											</div>
										</div>
									</div>
								</div>
							))
						)}
					</div>
				</div>
			</div>
		</Card>
	)
}
