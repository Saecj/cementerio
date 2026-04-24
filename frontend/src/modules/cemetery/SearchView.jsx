import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'

function prettyGraveStatus(status) {
	if (!status) return '—'
	const s = String(status)
	const map = {
		available: 'Disponible',
		occupied: 'Ocupada',
		reserved: 'Reservada',
		maintenance: 'Mantenimiento',
	}
	return map[s] || s
}

export function SearchView({ selectedKey, onSelect, onGoToMap, searchSeed }) {
	const [q, setQ] = useState('')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')
	const [items, setItems] = useState([])
	const [hasSearched, setHasSearched] = useState(false)

	useEffect(() => {
		if (!searchSeed?.ts) return
		const nextQ = typeof searchSeed.q === 'string' ? searchSeed.q : ''
		setQ(nextQ)
		setHasSearched(true)
	}, [searchSeed?.ts])

	useEffect(() => {
		let cancelled = false
		async function loadAll() {
			setLoading(true)
			setError('')
			setHasSearched(true)
			try {
				const result = await api('/api/client/reservations')
				if (!result.ok) {
					if (!cancelled) {
						setError(result.data?.error || 'No se pudieron cargar tus registros')
						setItems([])
					}
					return
				}
				const rows = Array.isArray(result.data?.reservations) ? result.data.reservations : []
				if (!cancelled) setItems(rows)
			} finally {
				if (!cancelled) setLoading(false)
			}
		}
		loadAll()
		return () => {
			cancelled = true
		}
	}, [])

	const filtered = useMemo(() => {
		const query = q.trim().toLowerCase()
		if (!query) return items
		return items.filter((it) => {
			const haystack = [
				it.deceased_full_name,
				it.reservation_code,
				it.grave_code,
				it.sector_name,
			]
				.filter(Boolean)
				.join(' ')
				.toLowerCase()
			return haystack.includes(query)
		})
	}, [items, q])

	function makeStableSeed(input) {
		const s = String(input ?? '')
		let h = 2166136261
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i)
			h = Math.imul(h, 16777619)
		}
		return h >>> 0
	}

	function stable01(seed) {
		let x = seed >>> 0
		x = (Math.imul(1664525, x) + 1013904223) >>> 0
		return x / 2 ** 32
	}

	function pseudoMapCoords(it) {
		const seed = makeStableSeed(it?.id ?? it?.reservation_code ?? it?.grave_code ?? it?.deceased_full_name ?? '')
		const x = 10 + stable01(seed) * 80
		const y = 18 + stable01(seed ^ 0x9e3779b9) * 70
		return { x: Math.round(x), y: Math.round(y) }
	}

	function onSearch(e) {
		e?.preventDefault()
		setHasSearched(true)
	}

	return (
		<div className="mt-6">
			<h2 className="text-sm font-semibold text-[color:var(--text-h)]">
				Búsqueda
			</h2>
			<form className="mt-2 flex gap-2" onSubmit={onSearch}>
				<input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					className="w-full rounded-md border border-[color:var(--border)] bg-transparent px-3 py-2 text-sm text-[color:var(--text-h)]"
					placeholder="Filtrar por nombre, código de reserva o tumba"
				/>
				<button
					disabled={loading}
					className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
				>
					{loading ? 'Cargando…' : 'Aplicar'}
				</button>
			</form>

			{error && <p className="mt-2 text-sm text-red-600">{error}</p>}

			{hasSearched && !loading && !error && filtered.length === 0 && (
				<p className="mt-3 text-sm text-[color:var(--text)]">Sin resultados.</p>
			)}

			{filtered.length > 0 && (
				<div className="mt-4 space-y-2">
					{filtered.map((it) => {
						const key = `resv-${it.id}`
						const isSelected = selectedKey && selectedKey === key
						const hasCoords = it.latitude != null && it.longitude != null
						const mapPos = hasCoords ? null : pseudoMapCoords(it)

						return (
							<div
								key={key}
								className={
									'ui-card rounded-md p-3 ' +
									(isSelected ? 'border-[color:var(--accent-border)] bg-[color:var(--surface-2)]' : '')
								}
							>
								<p className="text-sm font-semibold text-[color:var(--text-h)]">
									{it.deceased_full_name || '—'}
								</p>
								<div className="mt-2 grid gap-1 text-[11px] text-[color:var(--text)] sm:grid-cols-2">
									<div>
										<span className="ui-kicker">Reserva</span>
										<span className="ml-2 font-medium text-[color:var(--text-h)]">{it.reservation_code || '—'}</span>
									</div>
									<div>
										<span className="ui-kicker">Tumba</span>
										<span className="ml-2 font-medium text-[color:var(--text-h)]">{it.grave_code || '—'}</span>
									</div>
									<div>
										<span className="ui-kicker">Estado</span>
										<span className="ml-2">{prettyGraveStatus(it.grave_status)}</span>
									</div>
									<div>
										<span className="ui-kicker">Ubicación</span>
										<span className="ml-2">
											{it.sector_name ? it.sector_name : '—'}
											{it.row_number != null ? ` / Fila ${it.row_number}` : ''}
											{it.col_number != null ? ` / Col ${it.col_number}` : ''}
										</span>
									</div>
								</div>
								{hasCoords ? (
									<div className="mt-2 text-[11px] text-[color:var(--text)]">
										<span className="ui-kicker">Coords</span>
										<span className="ml-2">{it.latitude}, {it.longitude}</span>
									</div>
								) : null}
								{onSelect ? (
									<div className="mt-3 flex flex-wrap gap-2">
										<button
											onClick={() => onSelect(it)}
											className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[color:var(--on-accent)]"
										>
											{isSelected ? 'Seleccionado' : 'Seleccionar'}
										</button>
										<div className="flex flex-wrap items-center gap-2">
											<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-[11px] text-[color:var(--text)]">
												<span className="ui-kicker">Mapa</span>
												<span className="ml-2">
												{hasCoords
													? `(${it.latitude}, ${it.longitude})`
													: `(${mapPos.x}%, ${mapPos.y}%)`}
												</span>
											</div>
											<button
												type="button"
												onClick={() => {
													onSelect(it)
													onGoToMap?.()
												}}
												className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm text-[color:var(--text-h)] hover:bg-[color:var(--hover)]"
											>
												Ver mapa
											</button>
										</div>
									</div>
								) : null}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
