export function recordKey(r) {
	const id = r?.id
	if (id != null) return `resv-${id}`
	if (r?.reservation_code) return `rsv-${r.reservation_code}`
	if (r?.grave_code || r?.code) return `grave-${r.grave_code || r.code}`
	if (r?.deceased_full_name) return `name-${r.deceased_full_name}`
	return 'unknown'
}

export function makeStableSeed(input) {
	const s = String(input ?? '')
	let h = 2166136261
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

export function stable01(seed) {
	let x = seed >>> 0
	x = (Math.imul(1664525, x) + 1013904223) >>> 0
	return x / 2 ** 32
}

export function normalizeMapPayload(data) {
	const rows = Array.isArray(data?.graves)
		? data.graves
		: Array.isArray(data?.reservations)
			? data.reservations
			: []
	const source = Array.isArray(data?.graves) ? 'cemetery-map' : 'reservations'
	const by = new Map()
	for (const r of rows) {
		const name = String(r?.deceased_full_name || '').trim()
		const key = source === 'cemetery-map' ? recordKey(r) : name ? `name:${name.toLowerCase()}` : recordKey(r)
		if (!by.has(key)) by.set(key, r)
	}
	const items = Array.from(by.values()).sort(compareGraveRecords)
	const sectors = buildSections(items)
	const sectionCounts = new Map()
	const sectionIndexes = new Map()
	for (const r of items) {
		const key = sectionKey(r)
		sectionCounts.set(key, (sectionCounts.get(key) || 0) + 1)
	}
	const orderedItems = items.map((r) => {
		const key = sectionKey(r)
		const nextIndex = sectionIndexes.get(key) || 0
		sectionIndexes.set(key, nextIndex + 1)
		return {
			...r,
			__section_index: nextIndex,
			__section_count: sectionCounts.get(key) || 1,
		}
	})
	const markers = orderedItems.map((r) => {
		const id = recordKey(r)
		const seed = makeStableSeed(id)
		const layout = getLayoutPosition(r, sectors, seed)
		const hue = Math.floor(stable01(seed ^ 0x7f4a7c15) * 300)
		return { id, record: r, hue, ...layout }
	})
	return { items: orderedItems, markers, sectors, source }
}

export function buildSections(items) {
	const map = new Map()
	for (const r of items) {
		const inferred = inferSectionFromRecord(r)
		const rawId = r?.sector_id ?? r?.sector_name ?? inferred.id
		const id = String(rawId || 'general')
		const name = String(r?.sector_name || inferred.name || 'Sector general').trim()
		if (!map.has(id)) {
			map.set(id, {
				id,
				name,
				branchName: String(r?.branch_name || '').trim(),
				count: 0,
				minRow: Infinity,
				maxRow: -Infinity,
				minCol: Infinity,
				maxCol: -Infinity,
			})
		}
		const section = map.get(id)
		section.count += 1
		const row = numberOrNull(r?.row_number)
		const col = numberOrNull(r?.col_number)
		if (row != null) {
			section.minRow = Math.min(section.minRow, row)
			section.maxRow = Math.max(section.maxRow, row)
		}
		if (col != null) {
			section.minCol = Math.min(section.minCol, col)
			section.maxCol = Math.max(section.maxCol, col)
		}
	}
	const sections = Array.from(map.values()).map((s, index) => ({
		...s,
		index,
		minRow: Number.isFinite(s.minRow) ? s.minRow : 1,
		maxRow: Number.isFinite(s.maxRow) ? s.maxRow : Math.max(1, Math.ceil(Math.sqrt(s.count))),
		minCol: Number.isFinite(s.minCol) ? s.minCol : 1,
		maxCol: Number.isFinite(s.maxCol) ? s.maxCol : Math.max(1, Math.ceil(Math.sqrt(s.count))),
	}))
	return sections.length ? sections : [{ id: 'general', name: 'Sector general', branchName: '', count: 0, minRow: 1, maxRow: 1, minCol: 1, maxCol: 1, index: 0 }]
}

export function getLayoutPosition(record, sections, seed = makeStableSeed(recordKey(record))) {
	const safeSections = Array.isArray(sections) && sections.length ? sections : buildSections([record])
	const inferred = inferSectionFromRecord(record)
	const sectorId = String(record?.sector_id ?? record?.sector_name ?? inferred.id)
	const section = safeSections.find((s) => s.id === sectorId) || safeSections[0]
	const sectionCount = Math.max(1, safeSections.length)
	const cols = sectionCount <= 1 ? 1 : sectionCount <= 4 ? 2 : Math.ceil(Math.sqrt(sectionCount))
	const sectionRows = Math.ceil(sectionCount / cols)
	const gapX = 5.0
	const gapZ = 4.2
	const totalUsableW = 48
	const totalUsableD = 30
	const blockW = Math.max(7.2, (totalUsableW - gapX * (cols - 1)) / cols)
	const blockD = Math.max(6.2, (totalUsableD - gapZ * (sectionRows - 1)) / sectionRows)
	const gridX = section.index % cols
	const gridZ = Math.floor(section.index / cols)
	const totalW = cols * blockW + (cols - 1) * gapX
	const totalD = sectionRows * blockD + (sectionRows - 1) * gapZ
	const originX = gridX * (blockW + gapX) - totalW / 2 + blockW / 2
	const originZ = gridZ * (blockD + gapZ) - totalD / 2 + blockD / 2
	const innerW = Math.max(3.8, blockW - 3.0)
	const innerD = Math.max(3.6, blockD - 2.6)

	const localTotal = Math.max(1, Number(record?.__section_count) || section.count || 1)
	const localIndex = Math.max(0, Number(record?.__section_index) || 0)
	const localCols = Math.max(1, Math.ceil(Math.sqrt(localTotal)))
	const lx = localIndex % localCols
	const lz = Math.floor(localIndex / localCols)
	const localRows = Math.max(1, Math.ceil(localTotal / localCols))
	const nx = (lx + 0.5) / localCols
	const nz = (lz + 0.5) / localRows
	return {
		x: 8 + nx * 84,
		y: 10 + nz * 78,
		worldX: originX + (nx - 0.5) * innerW,
		worldZ: originZ + (nz - 0.5) * innerD,
		sectionId: section.id,
		sectionName: section.name,
		sectionCenterX: originX,
		sectionCenterZ: originZ,
		sectionWidth: blockW,
		sectionDepth: blockD,
	}
}

function sectionKey(r) {
	const inferred = inferSectionFromRecord(r)
	return String(r?.sector_id ?? r?.sector_name ?? inferred.id)
}

function compareGraveRecords(a, b) {
	const sa = sectionKey(a).localeCompare(sectionKey(b), undefined, { numeric: true })
	if (sa !== 0) return sa
	const ra = numberOrNull(a?.row_number) ?? 999999
	const rb = numberOrNull(b?.row_number) ?? 999999
	if (ra !== rb) return ra - rb
	const ca = numberOrNull(a?.col_number) ?? 999999
	const cb = numberOrNull(b?.col_number) ?? 999999
	if (ca !== cb) return ca - cb
	return String(a?.grave_code || a?.code || '').localeCompare(String(b?.grave_code || b?.code || ''), undefined, { numeric: true })
}

function inferSectionFromRecord(r) {
	const code = String(r?.grave_code || r?.code || '').trim()
	const match = code.match(/^([A-Za-z])(?:[-\s_]|$)/)
	if (match?.[1]) {
		const letter = match[1].toUpperCase()
		return { id: `section-${letter}`, name: `Seccion ${letter}` }
	}
	return { id: 'general', name: 'Sector general' }
}

function numberOrNull(value) {
	const n = value != null ? Number(value) : null
	return Number.isFinite(n) ? n : null
}
