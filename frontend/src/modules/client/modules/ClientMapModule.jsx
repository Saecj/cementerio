import { useMemo, useState } from 'react'
import { Panel } from '../../layout/Panel'
import { api } from '../../../lib/api'
import { MapView } from '../MapView'
import { recordKey } from '../mapUtils'
import { useClientCemeteryMap } from '../useClientCemeteryMap'


export function ClientMapModule({ me, selected, onSelect }) {
	const [cemOpen, setCemOpen] = useState(false)
	const [cemEverOpened, setCemEverOpened] = useState(false)
	const [cemLoading, setCemLoading] = useState(false)
	const [cemError, setCemError] = useState('')
	const [cemLocation, setCemLocation] = useState(null)
	const [cemPinnedEmbedSrc, setCemPinnedEmbedSrc] = useState(null)
	const [cemPinnedHref, setCemPinnedHref] = useState(null)

	const { loading, error, items: grouped, markers, sectors } = useClientCemeteryMap(me)

	const cemeteryCoords = useMemo(() => {
		const lat = cemLocation?.latitude != null ? Number(cemLocation.latitude) : null
		const lng = cemLocation?.longitude != null ? Number(cemLocation.longitude) : null
		return {
			lat: Number.isFinite(lat) ? lat : null,
			lng: Number.isFinite(lng) ? lng : null,
		}
	}, [cemLocation])

	const cemeteryLabel = useMemo(() => {
		const name = String(cemLocation?.name || '').trim()
		const address = String(cemLocation?.address || '').trim()
		return {
			name: name || 'Cementerio',
			address: address || '',
		}
	}, [cemLocation])

	async function loadCemeteryLocationOnce() {
		if (cemLocation || cemLoading) return cemLocation
		setCemLoading(true)
		setCemError('')
		try {
			const res = await api('/api/public/cemetery-location')
			if (!res.ok) {
				setCemError(res.data?.error || 'No se pudo cargar la ubicación del cementerio.')
				return null
			}
			const next = res.data?.location || null
			setCemLocation(next)
			return next
		} finally {
			setCemLoading(false)
		}
	}

	function pinEmbedFromLocation(loc) {
		const lat = loc?.latitude != null ? Number(loc.latitude) : null
		const lng = loc?.longitude != null ? Number(loc.longitude) : null
		const hasCoords = Number.isFinite(lat) && Number.isFinite(lng)
		const address = String(loc?.address || '').trim()
		const q = hasCoords ? `${lat},${lng}` : address
		if (!q) {
			setCemPinnedEmbedSrc(null)
			setCemPinnedHref(null)
			return
		}
		setCemPinnedHref(`https://www.google.com/maps?q=${encodeURIComponent(q)}`)
		setCemPinnedEmbedSrc(`https://www.google.com/maps?q=${encodeURIComponent(q)}&z=16&output=embed`)
	}

	async function toggleCemeteryMap() {
		const next = !cemOpen
		setCemOpen(next)
		if (!next) return
		if (!cemEverOpened) setCemEverOpened(true)
		const loc = (await loadCemeteryLocationOnce()) || cemLocation || null
		// Pinea el embed para evitar que cambie/re-cargue mientras el usuario navega.
		pinEmbedFromLocation(loc)
	}

	return (
		<Panel className="p-0">
			<div className="border-b border-[color:var(--border)] bg-[color:var(--surface)] p-3">
				<div className="ui-card rounded-md p-3">
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="ui-kicker">Ubicación</div>
							<div className="mt-0.5 text-sm font-semibold text-[color:var(--text-h)]">Mapa general del cementerio</div>
							<div className="mt-1 text-xs text-[color:var(--text)]">
								{cemLocation ? (
									<>
										<span className="font-medium text-[color:var(--text-h)]">{cemeteryLabel.name}</span>
										{cemeteryLabel.address ? ` · ${cemeteryLabel.address}` : ''}
										{cemeteryCoords.lat != null && cemeteryCoords.lng != null
											? ` · ${cemeteryCoords.lat}, ${cemeteryCoords.lng}`
											: ''}
									</>
								) : (
									<>Muéstralo cuando lo necesites (no consume API si está oculto).</>
								)}
							</div>
							{cemError ? <div className="mt-1 text-xs text-red-600">{cemError}</div> : null}
						</div>

						<div className="flex items-center justify-end gap-2">
							<button
								type="button"
								onClick={toggleCemeteryMap}
								className={
									'inline-flex h-10 items-center rounded-md border px-3 text-sm font-medium ' +
									(cemOpen
										? 'border-[color:var(--accent-border)] bg-[color:var(--accent-bg)] text-[color:var(--text-h)]'
										: 'border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-h)] hover:bg-[color:var(--hover)]')
								}
							>
								{cemOpen ? 'Ocultar mapa' : cemLoading ? 'Cargando…' : 'Mostrar mapa'}
							</button>
							{cemPinnedHref ? (
								<a
									href={cemPinnedHref}
									target="_blank"
									rel="noreferrer"
									className="inline-flex h-10 items-center rounded-md bg-[color:var(--accent)] px-3 text-sm font-medium text-[color:var(--on-accent)]"
								>
									Abrir
								</a>
							) : null}
						</div>
					</div>

					{cemEverOpened && cemPinnedEmbedSrc ? (
						<div className={cemOpen ? 'mt-3' : 'mt-3 hidden'}>
							<div className="overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)]">
								<iframe
									title="Mapa general del cementerio"
									src={cemPinnedEmbedSrc}
									className="block h-[320px] w-full"
									loading="lazy"
									referrerPolicy="no-referrer-when-downgrade"
									allowFullScreen
								/>
							</div>
							<div className="mt-2 text-xs text-[color:var(--text)]">
								Se carga una sola vez y luego solo se oculta.
							</div>
						</div>
					) : cemEverOpened && cemOpen ? (
						<div className="mt-3 text-sm text-[color:var(--text)]">
							Aún no está configurada la ubicación general del cementerio.
						</div>
					) : null}
				</div>
			</div>

			<div className="flex flex-col gap-0 lg:flex-row">
				{/* Lista lateral */}
				<div className="border-b border-[color:var(--border)] bg-[color:var(--surface)] p-3 lg:w-72 lg:border-b-0 lg:border-r">
					<div className="client-map-sidebar__head">
						<div>
							<div className="text-sm font-semibold text-[color:var(--text-h)]">Mis difuntos</div>
							<div className="mt-1 text-xs text-[color:var(--text)]">Ubicados por sector, fila y columna.</div>
						</div>
						<div className="client-map-sidebar__count">{grouped.length}</div>
					</div>

					{sectors.length > 0 ? (
						<div className="client-map-section-strip">
							{sectors.slice(0, 6).map((s) => (
								<div key={s.id} className="client-map-section-pill">
									<span>{s.name}</span>
									<strong>{s.count}</strong>
								</div>
							))}
						</div>
					) : null}

					{!me ? (
						<div className="mt-3 text-sm text-[color:var(--text)]">Inicia sesión para ver tus difuntos en el mapa.</div>
					) : null}
					{me && loading ? <div className="mt-3 text-sm text-[color:var(--text)]">Cargando…</div> : null}
					{me && error ? <div className="mt-3 text-sm text-red-600">{error}</div> : null}

					{me && !loading && !error ? (
						<div className="mt-3 space-y-2">
							{grouped.length === 0 ? (
								<div className="text-sm text-[color:var(--text)]">Aún no tienes difuntos registrados para mostrar.</div>
							) : (
								grouped.map((r) => {
									const id = recordKey(r)
									const marker = markers.find((m) => m.id === id)
									const hue = marker?.hue ?? 0
									const graveCode = r?.grave_code || r?.code || ''
									const name = r?.deceased_full_name || r?.deceased_name || r?.deceasedFullName || r?.reserved_deceased_full_name || 'Difunto sin nombre'
									const meta = [
										graveCode ? `Tumba ${graveCode}` : '',
										r?.sector_name,
										r?.row_number != null ? `F${r.row_number}` : '',
										r?.col_number != null ? `C${r.col_number}` : '',
									].filter(Boolean).join(' · ')
									const status = r?.status || r?.grave_status || ''
									const active = selected && recordKey(selected) === id
									return (
										<button
											key={id || name}
											type="button"
											onClick={() => onSelect?.(r)}
											className={'client-map-deceased-card ' + (active ? 'client-map-deceased-card--active' : '')}
										>
											<span
												className="client-map-deceased-card__dot"
												style={{ filter: `hue-rotate(${hue}deg) saturate(1.2)` }}
												aria-hidden="true"
											/>
											<span className="min-w-0 flex-1">
												<span className="client-map-deceased-card__name">{name}</span>
												{meta ? <span className="client-map-deceased-card__meta">{meta}</span> : null}
											</span>
											{status ? <span className="client-map-deceased-card__status">{status}</span> : null}
										</button>
									)
								})
							)}
						</div>
					) : null}
				</div>

				{/* Mapa */}
				<div className="min-w-0 flex-1 p-3">
					<MapView selected={selected} markers={markers} sections={sectors} onSelect={onSelect} />
				</div>
			</div>
		</Panel>
	)
}
