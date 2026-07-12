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
	const markers = buildNicheMarkers(orderedItems)
	return { items: orderedItems, markers, sectors, source }
}

function buildNicheMarkers(items) {
	const list = Array.isArray(items) ? items : []
	const sectionLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
	const sectionSlots = [
		{ centerX: -18.5, centerZ: 8.8 },
		{ centerX: 18.5, centerZ: 8.8 },
		{ centerX: -18.5, centerZ: -11.8 },
		{ centerX: 18.5, centerZ: -11.8 },
		{ centerX: -26.2, centerZ: -1.5 },
		{ centerX: 26.2, centerZ: -1.5 },
		{ centerX: -7.6, centerZ: -15.2 },
		{ centerX: 7.6, centerZ: -15.2 },
	]
	const bySection = new Map()
	list.forEach((r, idx) => {
		const inferred = inferSectionFromRecord(r)
		const rawName = String(r?.sector_name || inferred.name || '').trim()
		const key = String(r?.sector_id ?? rawName ?? inferred.id ?? 'general')
		if (!bySection.has(key)) {
			bySection.set(key, {
				key,
				name: rawName || sectionLetters[bySection.size] || `Sección ${bySection.size + 1}`,
				items: [],
			})
		}
		bySection.get(key).items.push({ r, idx })
	})

	const placed = []
	Array.from(bySection.values())
		.sort((a, b) => String(a.name).localeCompare(String(b.name), 'es', { numeric: true, sensitivity: 'base' }))
		.forEach((section, baseIndex) => {
			const sorted = [...section.items].sort((a, b) => compareGraveRecords(a.r, b.r) || a.idx - b.idx)
			const slot = sectionSlots[baseIndex % sectionSlots.length]
			const overflowRing = Math.floor(baseIndex / sectionSlots.length)
			const baseLetter = String(section.name || sectionLetters[baseIndex] || 'S')
				.replace(/^Secci[oó]n\s+/i, '')
				.trim()
				.slice(0, 2)
				.toUpperCase()
			const chunkCount = Math.max(1, Math.ceil(sorted.length / 10))
			const sectionCenterX = slot.centerX + overflowRing * (slot.centerX < 0 ? 1.4 : -1.4)
			const sectionCenterZ = slot.centerZ + overflowRing * 1.15
			const nicheCols = Math.min(3, chunkCount)
			const nicheRows = Math.ceil(chunkCount / nicheCols)
			const sectionWidth = Math.max(12.8, nicheCols * 4.4 + 2.8)
			const sectionDepth = Math.max(11.2, nicheRows * 4.4 + 7.2)

			sorted.forEach((entry, localIndex) => {
				const chunk = Math.floor(localIndex / 10)
				const nicheCol = chunk % nicheCols
				const nicheRow = Math.floor(chunk / nicheCols)
				const nicheCenterX = sectionCenterX + (nicheCol - (nicheCols - 1) / 2) * 4.4
				const nicheCenterZ = sectionCenterZ - sectionDepth / 2 + 1.65 + nicheRow * 4.4
				placed.push({
					...entry,
					localIndex: localIndex % 10,
					sectionId: section.key,
					sectionName: `Sección ${baseLetter}`,
					sectionLetter: baseLetter,
					originalSectorName: section.name,
					sectionCenterX,
					sectionCenterZ,
					sectionWidth,
					sectionDepth,
					nicheIndex: chunk,
					nicheCenterX,
					nicheCenterZ,
				})
			})
		})

	return placed.map((entry) => {
		const r = entry.r
		const id = recordKey(r)
		const seed = makeStableSeed(id)
		const col = Math.floor(entry.localIndex / 5)
		const row = entry.localIndex % 5
		const worldX = entry.nicheCenterX + (col - 0.5) * 0.78
		const worldZ = entry.nicheCenterZ + 0.72
		const worldY = 0.58 + (4 - row) * 0.34
		const state = markerVisualState(r)
		const isPremium = String(r?.grave_type_name || '').trim().toLowerCase() === 'premium'
		return {
			id,
			record: {
				...r,
				grave_code: r?.grave_code || r?.code || '',
				sector_name: entry.sectionLetter || r?.sector_name || '',
				section_name: entry.sectionName,
				original_sector_name: entry.originalSectorName || r?.sector_name || '',
				state,
				grave_status: r?.grave_status || state,
				reservation_status: r?.reservation_status || r?.status || '',
				availability_status: r?.availability_status || '',
				is_premium: isPremium,
			},
			sectionId: entry.sectionId,
			sectionName: entry.sectionName,
			sectionLetter: entry.sectionLetter,
			sectionCenterX: entry.sectionCenterX,
			sectionCenterZ: entry.sectionCenterZ,
			sectionWidth: entry.sectionWidth,
			sectionDepth: entry.sectionDepth,
			sectionCapacity: 10,
			nicheCount: 1,
			isPremium,
			renderMode: 'nicheSlot',
			nicheCenterX: entry.nicheCenterX,
			nicheCenterZ: entry.nicheCenterZ,
			nicheIndex: entry.nicheIndex,
			nicheSlotIndex: entry.localIndex,
			worldY,
			state,
			status: state,
			worldX,
			worldZ,
			x: 50 + (worldX / 28) * 50,
			y: 50 + (worldZ / 18) * 50,
			hue: Math.floor(stable01(seed ^ 0x7f4a7c15) * 140),
		}
	})
}

function markerVisualState(r) {
	const graveStatus = String(r?.grave_status || '').trim().toLowerCase()
	const reservationStatus = String(r?.reservation_status || r?.status || '').trim().toLowerCase()
	const paymentStatus = String(r?.payment_status || '').trim().toLowerCase()
	if (r?.has_burial || graveStatus === 'occupied') return 'occupied'
	if (graveStatus === 'maintenance') return 'maintenance'
	if (reservationStatus === 'pending' || paymentStatus === 'pending') return 'pending'
	if (reservationStatus === 'confirmed' || graveStatus === 'reserved') return 'reserved'
	if (graveStatus === 'available') return 'available'
	return 'reserved'
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
