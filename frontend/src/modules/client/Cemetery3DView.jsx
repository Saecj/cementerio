import { useEffect, useMemo, useRef, useState } from 'react'

function recordKey(r) {
	const id = r?.id
	if (id != null) return `resv-${id}`
	if (r?.reservation_code) return `rsv-${r.reservation_code}`
	if (r?.grave_code) return `grave-${r.grave_code}`
	if (r?.deceased_full_name) return `name-${r.deceased_full_name}`
	return 'unknown'
}

function clamp(n, min, max) {
	return Math.max(min, Math.min(max, n))
}

function asName(r) {
	return (
		r?.deceased_full_name ||
		r?.reserved_deceased_full_name ||
		r?.occupied_deceased_full_name ||
		r?.deceased_name ||
		r?.deceasedFullName ||
		`${r?.last_name || ''} ${r?.first_name || ''}`.trim() ||
		'Difunto sin nombre'
	)
}

function toYearsLabel(r) {
	const born = r?.born_year != null ? Number(r.born_year) : null
	const died = r?.died_year != null ? Number(r.died_year) : null
	if (Number.isFinite(born) && Number.isFinite(died)) return `${born}–${died}`
	return ''
}

function normalizeGraveState(value) {
	const s = String(value || '').trim().toLowerCase()
	if (!s) return ''
	if (['occupied', 'ocupada', 'ocupado', 'buried', 'inhumada', 'inhumado', 'vendida', 'vendido'].includes(s)) return 'occupied'
	if (['confirmed', 'reserved', 'reservada', 'reservado', 'approved', 'aprobada', 'aprobado', 'pagado', 'paid'].includes(s)) return 'reserved'
	if (['pending', 'pendiente', 'por aprobar'].includes(s)) return 'pending'
	if (['maintenance', 'mantenimiento', 'disabled', 'inactiva', 'inactivo', 'bloqueada', 'bloqueado'].includes(s)) return 'maintenance'
	if (['available', 'disponible', 'libre', 'free'].includes(s)) return 'available'
	return 'available'
}

function markerState(m) {
	const r = m?.record || {}
	const values = [
		m?.state,
		m?.status,
		r?.state,
		r?.status,
		r?.grave_status,
		r?.active_reservation_status,
		r?.reservation_status,
		r?.payment_status,
		r?.availability_status,
	]
	if (r?.has_burial || values.some((v) => normalizeGraveState(v) === 'occupied')) return 'occupied'
	if (values.some((v) => normalizeGraveState(v) === 'pending')) return 'pending'
	if (values.some((v) => normalizeGraveState(v) === 'reserved')) return 'reserved'
	if (r?.is_enabled === false || values.some((v) => normalizeGraveState(v) === 'maintenance')) return 'maintenance'
	return 'available'
}

function stateLabel(state) {
	if (state === 'occupied') return 'Ocupada'
	if (state === 'reserved') return 'Reservada'
	if (state === 'pending') return 'Pendiente'
	if (state === 'maintenance') return 'Mantenimiento'
	return 'Disponible'
}

function isPremiumMarker(m) {
	return !!(m?.isPremium || m?.record?.is_premium || String(m?.record?.grave_type_name || '').trim().toLowerCase() === 'premium')
}

const graveStateLegend = [
	{ state: 'available', label: 'Disponible', color: '#22c55e' },
	{ state: 'reserved', label: 'Reservada', color: '#f59e0b' },
	{ state: 'occupied', label: 'Ocupada', color: '#475569' },
	{ state: 'pending', label: 'Pendiente', color: '#38bdf8' },
	{ state: 'maintenance', label: 'Mantenimiento', color: '#94a3b8' },
]

function stableSeedFromString(input) {
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

export function Cemetery3DView({ markers = [], sections = [], selected = null, onSelect, variant = 'card' }) {
	const canvasRef = useRef(null)
	const rootRef = useRef(null)
	const rafRef = useRef(0)
	const cleanupRef = useRef(null)
	const pickedKeyRef = useRef('')
	const controlsRef = useRef({ reset: null, toggleFog: null })

	const isImmersive = variant === 'immersive'

	const [uiError, setUiError] = useState('')
	const [picked, setPicked] = useState(null)
	const [fogOn, setFogOn] = useState(isImmersive)

	const pickedLabel = useMemo(() => {
		const r = picked?.record || null
		if (!r) return null
		return {
			name: asName(r),
			years: toYearsLabel(r),
			grave: r?.grave_code ? String(r.grave_code) : '',
			sector: picked?.sectionName || (r?.section_name ? String(r.section_name) : '') || (r?.sector_name ? `Sección ${String(r.sector_name)}` : ''),
			row: r?.row_number != null ? String(r.row_number) : '',
			col: r?.col_number != null ? String(r.col_number) : '',
			status: stateLabel(markerState(picked)),
		}
	}, [picked])

	const sectionSummary = useMemo(() => {
		const markerSectionNames = Array.from(
			new Set(
				(Array.isArray(markers) ? markers : [])
					.map((m) => String(m?.sectionName || m?.record?.sector_name || '').trim())
					.filter(Boolean),
			),
		)
		const count = markerSectionNames.length || (Array.isArray(sections) && sections.length ? sections.length : 1)
		const first = markerSectionNames[0] || (Array.isArray(sections) && sections.length ? sections[0]?.name : 'Sector general')
		return { count, first: first || 'Sector general' }
	}, [markers, sections])

	useEffect(() => {
		setPicked((prev) => {
			if (!selected) return prev
			const key = recordKey(selected)
			const next = markers.find((m) => String(m?.id || '') === String(key))
			return next || prev
		})
	}, [markers, selected])

	useEffect(() => {
		pickedKeyRef.current = picked ? String(picked?.id || '') : ''
		try {
			controlsRef.current?.requestRender?.()
		} catch {
			// ignore
		}
	}, [picked])

	useEffect(() => {
		let cancelled = false
		setUiError('')

		async function init() {
			const canvas = canvasRef.current
			const root = rootRef.current
			if (!canvas || !root) return

			// En Jest/JSDOM evitamos tocar WebGL/canvas para no generar ruido.
			const isJest =
				typeof process !== 'undefined' &&
				process?.env &&
				(process.env.JEST_WORKER_ID != null || process.env.NODE_ENV === 'test')
			if (isJest) return

			// Si ya había una instancia anterior (por rerender/StrictMode), limpiarla primero.
			try {
				cleanupRef.current?.()
			} catch {
				// ignore
			}

			const THREE = await import('three')
			if (cancelled) return

			function cssVar(name, fallback = '') {
				try {
					const v = getComputedStyle(document.documentElement).getPropertyValue(name)
					return (v || '').trim() || fallback
				} catch {
					return fallback
				}
			}

			function themedGreen(baseCss) {
				// Derivamos un verde claro desde un color del tema (ej. --az4), rotando el hue.
				// Esto mantiene coherencia con la paleta sin introducir “colores arbitrarios” en CSS.
				const c = new THREE.Color(baseCss)
				const hsl = { h: 0, s: 0, l: 0 }
				c.getHSL(hsl)
				c.setHSL((hsl.h + 0.33) % 1, 0.38, 0.72)
				return c
			}

			function makeNoiseTexture({ size = 256, base = '#ffffff', speckle = 0.08, lines = false } = {}) {
				const cnv = document.createElement('canvas')
				cnv.width = size
				cnv.height = size
				const ctx = cnv.getContext('2d')
				ctx.fillStyle = base
				ctx.fillRect(0, 0, size, size)
				const img = ctx.getImageData(0, 0, size, size)
				const d = img.data
				for (let i = 0; i < d.length; i += 4) {
					const n = (Math.random() - 0.5) * 255 * speckle
					d[i] = clamp(d[i] + n, 0, 255)
					d[i + 1] = clamp(d[i + 1] + n, 0, 255)
					d[i + 2] = clamp(d[i + 2] + n, 0, 255)
				}
				ctx.putImageData(img, 0, 0)

				if (lines) {
					ctx.globalAlpha = 0.14
					ctx.strokeStyle = 'rgba(0,0,0,0.35)'
					ctx.lineWidth = 1
					for (let i = 0; i < size; i += 6) {
						ctx.beginPath()
						ctx.moveTo(i + (Math.random() - 0.5) * 2, 0)
						ctx.lineTo(i + (Math.random() - 0.5) * 2, size)
						ctx.stroke()
					}
					ctx.globalAlpha = 1
				}

				const tex = new THREE.CanvasTexture(cnv)
				tex.wrapS = THREE.RepeatWrapping
				tex.wrapT = THREE.RepeatWrapping
				tex.colorSpace = THREE.SRGBColorSpace
				tex.needsUpdate = true
				return tex
			}

			let renderer
			try {
				// Importante: NO llamar canvas.getContext manualmente.
				// Si lo hacemos, podemos dejar un contexto incompatible y romper el renderer.
				renderer = new THREE.WebGLRenderer({ canvas, antialias: !isImmersive, alpha: true })
			} catch {
				setUiError('No se pudo crear WebGL. Activa aceleración por hardware o prueba otro navegador.')
				return
			}
			const dprCap = isImmersive ? 1.25 : 2
			renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap))
			renderer.shadowMap.enabled = !isImmersive
			if (!isImmersive) renderer.shadowMap.type = THREE.PCFShadowMap
			if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace

			const scene = new THREE.Scene()
			// Fondo: claro (default) o nocturno (inmersivo)
			const bgBase = new THREE.Color(cssVar('--surface-2', '#eefbf2'))
			const bgGreen = themedGreen(cssVar('--az4', '#4ade80'))
			if (isImmersive) {
				scene.background = new THREE.Color('#314245')
			} else {
				scene.background = bgBase.clone().lerp(bgGreen, 0.22)
			}

			const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 250)
			let theta = 0
			let phi = 0.35
			let radius = isImmersive ? 34 : 38
			let targetTheta = 0
			let targetPhi = 0.35
			let targetRadius = isImmersive ? 34 : 38
			let isRunning = false
			let needsRender = true

			let fogEnabled = isImmersive
			try {
				const fogColor = scene.background ? scene.background.clone() : new THREE.Color('#050a08')
				scene.fog = new THREE.FogExp2(fogColor.getHex(), fogEnabled ? 0.045 : 0.0)
			} catch {
				// ignore
			}

			const sun = new THREE.DirectionalLight(0xffffff, isImmersive ? 1.1 : 1.32)
			sun.position.set(12, 18, 10)
			sun.castShadow = !isImmersive
			if (!isImmersive) {
				sun.shadow.mapSize.set(2048, 2048)
				sun.shadow.camera.near = 0.5
				sun.shadow.camera.far = 80
				sun.shadow.camera.left = -25
				sun.shadow.camera.right = 25
				sun.shadow.camera.top = 25
				sun.shadow.camera.bottom = -25
			}
			scene.add(sun)

			const hemi = new THREE.HemisphereLight(
				bgBase.clone().lerp(bgGreen, isImmersive ? 0.12 : 0.25),
				bgGreen.clone().multiplyScalar(isImmersive ? 0.42 : 0.65),
				isImmersive ? 0.78 : 0.92,
			)
			scene.add(hemi)
			scene.add(new THREE.AmbientLight(0xffffff, isImmersive ? 0.24 : 0.38))

			function addAtmosphere() {
				const skyGeo = new THREE.SphereGeometry(118, 32, 16)
				const skyMat = new THREE.ShaderMaterial({
					side: THREE.BackSide,
					depthWrite: false,
					uniforms: {
						topColor: { value: new THREE.Color('#7fb8d9') },
						bottomColor: { value: new THREE.Color('#d8efe5') },
					},
					vertexShader: `
						varying vec3 vWorldPosition;
						void main() {
							vec4 worldPosition = modelMatrix * vec4(position, 1.0);
							vWorldPosition = worldPosition.xyz;
							gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
						}
					`,
					fragmentShader: `
						uniform vec3 topColor;
						uniform vec3 bottomColor;
						varying vec3 vWorldPosition;
						void main() {
							float h = normalize(vWorldPosition).y * 0.5 + 0.5;
							gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(0.08, 0.92, h)), 1.0);
						}
					`,
				})
				const sky = new THREE.Mesh(skyGeo, skyMat)
				scene.add(sky)

				const sunMat = new THREE.MeshBasicMaterial({ color: '#fff2b8', transparent: true, opacity: 0.94, depthWrite: false })
				const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(3.0, 40), sunMat)
				sunDisc.position.set(-34, 28, -48)
				sunDisc.lookAt(camera.position)
				sunDisc.renderOrder = -5
				scene.add(sunDisc)

				const moonMat = new THREE.MeshBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.62, depthWrite: false })
				const moon = new THREE.Mesh(new THREE.CircleGeometry(1.5, 32), moonMat)
				moon.position.set(36, 24, -52)
				moon.lookAt(camera.position)
				moon.renderOrder = -5
				scene.add(moon)

				const cloudMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', transparent: true, opacity: 0.78, roughness: 1.0, metalness: 0 })
				const cloudPositions = [
					[-30, 20, -34, 1.1],
					[-8, 23, -42, 0.9],
					[18, 21, -36, 1.0],
					[34, 19, -22, 0.78],
				]
				cloudPositions.forEach(([x, y, z, s], idx) => {
					const cloud = new THREE.Group()
					for (let i = 0; i < 5; i++) {
						const puff = new THREE.Mesh(new THREE.SphereGeometry(1.1 + stable01(idx * 31 + i) * 0.55, 12, 8), cloudMat)
						puff.position.set((i - 2) * 1.35, stable01(idx * 101 + i) * 0.45, stable01(idx * 71 + i) * 0.55)
						puff.scale.set(1.45, 0.55, 0.75)
						cloud.add(puff)
					}
					cloud.position.set(x, y, z)
					cloud.scale.setScalar(s)
					scene.add(cloud)
				})
			}

			addAtmosphere()

			// Césped y follaje más verdes (vivos) manteniendo un look claro.
			const grassA = themedGreen(cssVar('--az4', '#4ade80'))
			grassA.setHSL(0.31, 0.42, 0.52)
			const grassB = themedGreen(cssVar('--az2', '#064e3b')).lerp(grassA, 0.72)
			grassB.setHSL(0.30, 0.34, 0.43)
			const soil = grassB.clone().offsetHSL(0.0, 0.06, -0.18)
			const path = new THREE.Color('#d6ddd4')
			const pathEdge = new THREE.Color(cssVar('--border', 'rgba(26,58,143,0.13)')).lerp(grassB, 0.35)
			const stone = new THREE.Color(cssVar('--surface', '#ffffff')).lerp(new THREE.Color(cssVar('--surface-2', '#f0f4ff')), 0.22)
			const stoneDark = stone.clone().offsetHSL(0, 0, -0.12)
			const metal = new THREE.Color(cssVar('--az1', '#052e1f')).lerp(new THREE.Color(cssVar('--az2', '#064e3b')), 0.35)

			const texSize = isImmersive ? 128 : 256
			const grassTex = makeNoiseTexture({ size: texSize, base: grassA.getStyle(), speckle: 0.06, lines: true })
			grassTex.repeat.set(8, 8)
			const gravelTex = makeNoiseTexture({ size: texSize, base: path.getStyle(), speckle: 0.1, lines: false })
			gravelTex.repeat.set(10, 10)

			const groundMat = new THREE.MeshStandardMaterial({ color: grassB, roughness: 0.98, metalness: 0.0, map: grassTex, bumpMap: grassTex, bumpScale: 0.06 })
			const soilMat = new THREE.MeshStandardMaterial({ color: soil, roughness: 1.0, metalness: 0.0 })
			const pathMat = new THREE.MeshStandardMaterial({ color: path, roughness: 0.98, metalness: 0.0, map: gravelTex, bumpMap: gravelTex, bumpScale: 0.04 })
			const pathEdgeMat = new THREE.MeshStandardMaterial({ color: pathEdge, roughness: 0.95, metalness: 0.0 })
			const stoneMat = new THREE.MeshStandardMaterial({ color: stone, roughness: 0.88, metalness: 0.02 })
			const stoneDarkMat = new THREE.MeshStandardMaterial({ color: stoneDark, roughness: 0.9, metalness: 0.02 })
			const metalMat = new THREE.MeshStandardMaterial({ color: metal, roughness: 0.65, metalness: 0.25 })
			const shadowMat = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.12, roughness: 1.0, metalness: 0.0 })

			function gravePalette(m) {
				const state = markerState(m)
				const accentHex = {
					available: '#22c55e',
					reserved: '#f59e0b',
					occupied: '#475569',
					pending: '#38bdf8',
					maintenance: '#94a3b8',
				}[state] || '#22c55e'
				const accent = new THREE.Color(accentHex)
				const plot = state === 'available' ? stoneDark.clone().lerp(accent, 0.36) : stoneDark.clone().lerp(accent, 0.72)
				const soilColor = state === 'available' ? soil.clone().lerp(accent, 0.24) : soil.clone().lerp(accent, 0.68)
				const head = state === 'occupied' || state === 'maintenance' ? stone.clone().lerp(accent, 0.72) : stone.clone().lerp(accent, 0.5)
				return { state, accent, plot, soil: soilColor, head }
			}

			function statusMaterial(color, roughness = 0.72) {
				return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 })
			}

			const seg = isImmersive ? 56 : 120
			const groundGeo = new THREE.PlaneGeometry(104, 104, seg, seg)
			// Relieve suave para que no se vea “plano”
			try {
				const pos = groundGeo.attributes.position
				for (let i = 0; i < pos.count; i++) {
					const x = pos.getX(i)
					const z = pos.getY(i)
					const n =
						(Math.sin((x + 11.1) * 0.22) + Math.cos((z - 7.7) * 0.24)) * 0.03 +
						(Math.sin((x + z) * 0.12) * 0.02)
					pos.setZ(i, n)
				}
				pos.needsUpdate = true
				groundGeo.computeVertexNormals()
			} catch {
				// ignore
			}
			const ground = new THREE.Mesh(groundGeo, groundMat)
			ground.rotation.x = -Math.PI / 2
			ground.receiveShadow = true
			scene.add(ground)

			function addLandscapeBands() {
				const meadowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#6f8f62'), roughness: 0.98, metalness: 0 })
				const flowerMatA = new THREE.MeshStandardMaterial({ color: new THREE.Color('#eab308'), roughness: 0.92, metalness: 0 })
				const flowerMatB = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f472b6'), roughness: 0.92, metalness: 0 })
				const shrubMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f6f3e'), roughness: 0.96, metalness: 0 })
				const bandData = [
					[-39, -3, 9, 54],
					[39, -3, 9, 54],
					[0, -39, 58, 8],
					[0, 35, 58, 7],
				]
				bandData.forEach(([x, z, w, d]) => {
					const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, d), meadowMat)
					band.position.set(x, 0.025, z)
					band.receiveShadow = true
					scene.add(band)
				})

				for (let i = 0; i < 90; i++) {
					const side = i % 4
					const x =
						side === 0 ? -35 - stable01(i * 17) * 11 :
						side === 1 ? 35 + stable01(i * 17) * 11 :
						(stable01(i * 19) - 0.5) * 76
					const z =
						side === 2 ? -35 - stable01(i * 23) * 8 :
						side === 3 ? 33 + stable01(i * 23) * 8 :
						(stable01(i * 29) - 0.5) * 64
					const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.32, 5), shrubMat)
					stem.position.set(x, 0.18, z)
					const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.11, 7, 5), i % 2 === 0 ? flowerMatA : flowerMatB)
					bloom.position.set(x, 0.38, z)
					scene.add(stem, bloom)
				}
			}

			addLandscapeBands()

			// Senderos con volumen + bordes
			function addPath(w, d, x, z) {
				const body = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), pathMat)
				body.position.set(x, 0.07, z)
				body.receiveShadow = true
				scene.add(body)
				const edgeL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, d + 0.12), pathEdgeMat)
				edgeL.position.set(x - w / 2 - 0.06, 0.075, z)
				edgeL.receiveShadow = true
				scene.add(edgeL)
				const edgeR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, d + 0.12), pathEdgeMat)
				edgeR.position.set(x + w / 2 + 0.06, 0.075, z)
				edgeR.receiveShadow = true
				scene.add(edgeR)
				return { body, edgeL, edgeR }
			}

			// Layout tipo cementerio “real”: camino principal desde el portón hacia una capilla al fondo,
			// más un cruce/placita central.
			const bx = 29
			const bz = 21
			const mainPathW = 3.2
			const mainPathD = bz * 2 - 4.2
			const mainPath = addPath(mainPathW, mainPathD, 0, 0.6)
			const crossPath = addPath(24, 2.4, 0, -4.4)
			addPath(22, 1.35, -15.2, -14.8)
			addPath(22, 1.35, 15.2, -14.8)
			addPath(22, 1.35, -15.2, 5.4)
			addPath(22, 1.35, 15.2, 5.4)
			addPath(1.35, 27.5, -15.2, -2.4)
			addPath(1.35, 27.5, 15.2, -2.4)
			addPath(1.1, 22, -25.7, -3.2)
			addPath(1.1, 22, 25.7, -3.2)
			const plaza = new THREE.Mesh(new THREE.BoxGeometry(8.8, 0.055, 5.4), pathMat)
			plaza.position.set(0, 0.068, -10.8)
			plaza.receiveShadow = true
			scene.add(plaza)

			function addAmenities() {
				const woodMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a5a3a'), roughness: 0.86, metalness: 0.02 })
				const planterMat = new THREE.MeshStandardMaterial({ color: stoneDark.clone().lerp(new THREE.Color('#a7b3a5'), 0.32), roughness: 0.9, metalness: 0.02 })
				const bushMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f7f4b'), roughness: 0.96, metalness: 0 })

				function bench(x, z, rot = 0) {
					const g = new THREE.Group()
					const seat = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.18, 0.45), woodMat)
					seat.position.set(0, 0.45, 0)
					const back = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.62, 0.16), woodMat)
					back.position.set(0, 0.82, -0.28)
					const legGeo = new THREE.BoxGeometry(0.14, 0.45, 0.14)
					;[-0.82, 0.82].forEach((lx) => {
						[-0.12, 0.2].forEach((lz) => {
							const leg = new THREE.Mesh(legGeo, metalMat)
							leg.position.set(lx, 0.22, lz)
							g.add(leg)
						})
					})
					g.add(seat, back)
					g.position.set(x, 0, z)
					g.rotation.y = rot
					scene.add(g)
				}

				function planter(x, z, w = 2.2, d = 0.72) {
					const box = new THREE.Mesh(new THREE.BoxGeometry(w, 0.38, d), planterMat)
					box.position.set(x, 0.2, z)
					box.castShadow = true
					box.receiveShadow = true
					scene.add(box)
					for (let i = 0; i < 4; i++) {
						const bush = new THREE.Mesh(new THREE.SphereGeometry(0.28, 9, 6), bushMat)
						bush.position.set(x - w / 2 + 0.45 + i * ((w - 0.9) / 3), 0.55, z)
						bush.scale.set(1.1, 0.55, 0.8)
						scene.add(bush)
					}
				}

				bench(-5.4, -9.2, Math.PI / 2)
				bench(5.4, -9.2, -Math.PI / 2)
				bench(-6.1, 4.8, Math.PI / 2)
				bench(6.1, 4.8, -Math.PI / 2)
				planter(-8.2, -10.8)
				planter(8.2, -10.8)
				planter(-10.8, 9.4, 2.8, 0.72)
				planter(10.8, 9.4, 2.8, 0.72)
			}

			addAmenities()

			function addDirectionMarker() {
				const group = new THREE.Group()
				const arrowMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f8fafc'), roughness: 0.72, metalness: 0.02 })
				const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#16a34a'), roughness: 0.6, metalness: 0.02 })
				const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 10), metalMat)
				post.position.set(0, 0.58, 0)
				const board = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.48, 0.12), arrowMat)
				board.position.set(0, 1.12, 0)
				const tip = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.72, 3), accentMat)
				tip.rotation.z = -Math.PI / 2
				tip.position.set(1.28, 1.12, 0)
				group.add(post, board, tip)
				group.position.set(-4.9, 0, 17.7)
				group.rotation.y = -Math.PI / 2
				scene.add(group)
			}

			addDirectionMarker()

			const gravestones = []
			const clickables = []
			const graveById = new Map()

			function keepAwayFromPaths(x, z, seed) {
				const mainHalf = mainPathW / 2
				if (Math.abs(x) < mainHalf + 2.6) {
					const side = stable01((seed ?? 0) ^ 0x27d4eb2d) < 0.5 ? -1 : 1
					x = side * (mainHalf + 4.2)
				}
				const crossZ = -4.4
				if (Math.abs(z - crossZ) < 2.4 && Math.abs(x) < 25.5) {
					const dir = stable01((seed ?? 0) ^ 0x165667b1) < 0.5 ? -1 : 1
					z = crossZ + dir * 3.8
				}
				;[-15.2, 15.2, -25.7, 25.7].forEach((pathX) => {
					if (Math.abs(x - pathX) < 1.45) x += x < pathX ? -1.55 : 1.55
				})
				;[-14.8, 5.4].forEach((pathZ) => {
					if (Math.abs(z - pathZ) < 1.25) z += z < pathZ ? -1.45 : 1.45
				})
				return { x, z }
			}

			function markerToXZ(m, seed) {
				const wx = Number(m?.worldX)
				const wz = Number(m?.worldZ)
				if (m?.worldX != null && m?.worldZ != null && Number.isFinite(wx) && Number.isFinite(wz)) {
					const pos = keepAwayFromPaths(wx, wz, seed)
					return {
						x: clamp(pos.x, -bx + 2.5, bx - 2.5),
						z: clamp(pos.z, -bz + 2.5, bz - 3.8),
					}
				}

				// markers vienen en % (0..100). Pasamos a un área cómoda.
				const mx = Number.isFinite(m?.x) ? Number(m.x) : 50
				const my = Number.isFinite(m?.y) ? Number(m.y) : 50
				const nx = (clamp(mx, 0, 100) - 50) / 50
				const nz = (clamp(my, 0, 100) - 50) / 50
				let x = nx * 24
				let z = nz * 16

				const pos = keepAwayFromPaths(x, z, seed)
				x = pos.x
				z = pos.z

				// Mantener dentro del perímetro
				x = clamp(x, -bx + 2.5, bx - 2.5)
				z = clamp(z, -bz + 2.5, bz - 3.8)
				return { x, z }
			}

			function collectVisualSections() {
				if (!Array.isArray(markers) || markers.length === 0) return
				const bySection = new Map()
				markers.forEach((m, idx) => {
					const seed = stableSeedFromString(String(m?.id || idx))
					const pos = markerToXZ(m, seed)
					const key = String(m?.sectionId || m?.record?.sector_id || m?.record?.sector_name || 'general')
					const name = String(m?.sectionName || m?.record?.sector_name || 'Sector general')
					if (!bySection.has(key)) {
						bySection.set(key, {
							key,
							name,
							letter: String(m?.sectionLetter || name || '?').replace(/^Secci[oó]n\s+/i, '').slice(0, 3).toUpperCase(),
							count: 0,
							minX: Infinity,
							maxX: -Infinity,
							minZ: Infinity,
							maxZ: -Infinity,
							centerX: Number.isFinite(Number(m?.sectionCenterX)) ? Number(m.sectionCenterX) : null,
							centerZ: Number.isFinite(Number(m?.sectionCenterZ)) ? Number(m.sectionCenterZ) : null,
							width: Number.isFinite(Number(m?.sectionWidth)) ? Number(m.sectionWidth) : null,
							depth: Number.isFinite(Number(m?.sectionDepth)) ? Number(m.sectionDepth) : null,
						})
					}
					const s = bySection.get(key)
					s.count += 1
					s.minX = Math.min(s.minX, pos.x)
					s.maxX = Math.max(s.maxX, pos.x)
					s.minZ = Math.min(s.minZ, pos.z)
					s.maxZ = Math.max(s.maxZ, pos.z)
					if (s.centerX == null && Number.isFinite(Number(m?.sectionCenterX))) s.centerX = Number(m.sectionCenterX)
					if (s.centerZ == null && Number.isFinite(Number(m?.sectionCenterZ))) s.centerZ = Number(m.sectionCenterZ)
					if (s.width == null && Number.isFinite(Number(m?.sectionWidth))) s.width = Number(m.sectionWidth)
					if (s.depth == null && Number.isFinite(Number(m?.sectionDepth))) s.depth = Number(m.sectionDepth)
				})
				return bySection
			}

			function addSectionGuides() {
				const bySection = collectVisualSections()
				if (!bySection || bySection.size === 0) return
				const sectionValues = Array.from(bySection.values())
				const centers = sectionValues.filter((s) => s.centerX != null && s.centerZ != null)
				if (centers.length > 1) {
					const minX = Math.min(...centers.map((s) => s.centerX - (s.width || 6) / 2))
					const maxX = Math.max(...centers.map((s) => s.centerX + (s.width || 6) / 2))
					const minZ = Math.min(...centers.map((s) => s.centerZ - (s.depth || 6) / 2))
					const maxZ = Math.max(...centers.map((s) => s.centerZ + (s.depth || 6) / 2))
					addPath(2.4, Math.max(6, maxZ - minZ + 5.2), 0, (minZ + maxZ) / 2)
					const rowZs = Array.from(new Set(centers.map((s) => Math.round(s.centerZ * 10) / 10))).sort((a, b) => a - b)
					rowZs.forEach((z) => {
						addPath(Math.max(8, maxX - minX + 4.6), 1.55, (minX + maxX) / 2, z)
					})
				}

				const guideGroup = new THREE.Group()
				const sectionBaseMat = new THREE.MeshStandardMaterial({
					color: grassA.clone().offsetHSL(0, 0.05, 0.11),
					transparent: true,
					opacity: isImmersive ? 0.34 : 0.44,
					roughness: 0.98,
					metalness: 0,
				})
				const borderMat = new THREE.LineBasicMaterial({
					color: new THREE.Color('#ecfdf5'),
					transparent: true,
					opacity: isImmersive ? 0.82 : 0.9,
				})

				function makeLabelTexture(text, count, letter) {
					const cnv = document.createElement('canvas')
					cnv.width = 1024
					cnv.height = 320
					const ctx = cnv.getContext('2d')
					ctx.clearRect(0, 0, cnv.width, cnv.height)
					ctx.fillStyle = 'rgba(5, 46, 31, 0.88)'
					ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)'
					ctx.lineWidth = 6
					roundRect(ctx, 24, 26, 976, 268, 34)
					ctx.fill()
					ctx.stroke()
					ctx.fillStyle = 'rgba(134, 239, 172, 0.18)'
					roundRect(ctx, 54, 58, 180, 204, 26)
					ctx.fill()
					ctx.fillStyle = '#86efac'
					ctx.font = '900 138px Arial'
					ctx.fillText(letter || 'S', 80, 204)
					ctx.fillStyle = '#ecfdf5'
					ctx.font = '900 56px Arial'
					ctx.fillText(text.slice(0, 22), 280, 128)
					ctx.fillStyle = 'rgba(236,253,245,0.82)'
					ctx.font = '800 34px Arial'
					ctx.fillText(`${count}/10 tumbas`, 282, 188)
					ctx.fillText('2 nichos', 282, 236)
					const tex = new THREE.CanvasTexture(cnv)
					tex.colorSpace = THREE.SRGBColorSpace
					tex.generateMipmaps = false
					tex.minFilter = THREE.LinearFilter
					tex.magFilter = THREE.LinearFilter
					tex.needsUpdate = true
					return tex
				}

				function roundRect(ctx, x, y, w, h, r) {
					ctx.beginPath()
					ctx.moveTo(x + r, y)
					ctx.lineTo(x + w - r, y)
					ctx.quadraticCurveTo(x + w, y, x + w, y + r)
					ctx.lineTo(x + w, y + h - r)
					ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
					ctx.lineTo(x + r, y + h)
					ctx.quadraticCurveTo(x, y + h, x, y + h - r)
					ctx.lineTo(x, y + r)
					ctx.quadraticCurveTo(x, y, x + r, y)
					ctx.closePath()
				}

				sectionValues.forEach((s) => {
					if (!Number.isFinite(s.minX) || !Number.isFinite(s.minZ)) return
					const pad = markers.length >= 80 ? 1.8 : 2.4
					const w = s.width != null ? Math.max(5.8, s.width) : Math.max(5.8, s.maxX - s.minX + pad * 2)
					const d = s.depth != null ? Math.max(5.4, s.depth) : Math.max(5.4, s.maxZ - s.minZ + pad * 2)
					const cx = s.centerX != null ? s.centerX : clamp((s.minX + s.maxX) / 2, -bx + w / 2 + 0.5, bx - w / 2 - 0.5)
					const cz = s.centerZ != null ? s.centerZ : clamp((s.minZ + s.maxZ) / 2, -bz + d / 2 + 0.5, bz - d / 2 - 4.8)

					const base = new THREE.Mesh(new THREE.BoxGeometry(w, 0.055, d), sectionBaseMat)
					base.position.set(cx, 0.045, cz)
					base.receiveShadow = true
					guideGroup.add(base)

					const edgeGeo = new THREE.BufferGeometry().setFromPoints([
						new THREE.Vector3(cx - w / 2, 0.13, cz - d / 2),
						new THREE.Vector3(cx + w / 2, 0.13, cz - d / 2),
						new THREE.Vector3(cx + w / 2, 0.13, cz + d / 2),
						new THREE.Vector3(cx - w / 2, 0.13, cz + d / 2),
						new THREE.Vector3(cx - w / 2, 0.13, cz - d / 2),
					])
					guideGroup.add(new THREE.Line(edgeGeo, borderMat))

					if (bySection.size <= 12) {
						const spriteMat = new THREE.SpriteMaterial({
							map: makeLabelTexture(s.name, s.count, s.letter),
							transparent: true,
							depthWrite: false,
							depthTest: false,
						})
						const label = new THREE.Sprite(spriteMat)
						label.position.set(cx, 3.75, cz - d / 2 - 0.85)
						label.scale.set(5.8, 1.8, 1)
						label.renderOrder = 20
						guideGroup.add(label)
					}
				})

				scene.add(guideGroup)
			}

			function addNichesForSections() {
				const bySection = collectVisualSections()
				if (!bySection || bySection.size === 0) return
				const group = new THREE.Group()
				const nicheBodyMat = new THREE.MeshStandardMaterial({ color: stone.clone().lerp(new THREE.Color('#ecfdf5'), 0.46), roughness: 0.86, metalness: 0.02 })
				const nicheBackMat = new THREE.MeshStandardMaterial({ color: stoneDark.clone().lerp(new THREE.Color('#064e3b'), 0.26), roughness: 0.9, metalness: 0.02 })
				const nicheAccentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#16a34a'), roughness: 0.62, metalness: 0.02 })
				const roofMat = new THREE.MeshStandardMaterial({ color: stoneDark.clone().lerp(new THREE.Color('#0f766e'), 0.58), roughness: 0.88, metalness: 0.02 })
				const slotMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f8fafc'), roughness: 0.78, metalness: 0.02 })
				const shadowSlotMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#14532d'), roughness: 0.88, metalness: 0.02 })
				const premiumBodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#f3ead7'), roughness: 0.74, metalness: 0.06 })
				const premiumBackMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3f321d'), roughness: 0.78, metalness: 0.08 })
				const premiumAccentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d6a936'), roughness: 0.46, metalness: 0.24 })
				const premiumRoofMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1f513d'), roughness: 0.72, metalness: 0.1 })
				const premiumSlotMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#fff7ed'), roughness: 0.68, metalness: 0.08 })

				function addNiche(x, z, rot, labelOffset, isPremium = false) {
					const niche = new THREE.Group()
					niche.position.set(x, 0, z)
					niche.rotation.y = rot
					const bodyMaterial = isPremium ? premiumBodyMat : nicheBodyMat
					const backMaterial = isPremium ? premiumBackMat : nicheBackMat
					const accentMaterial = isPremium ? premiumAccentMat : nicheAccentMat
					const roofMaterial = isPremium ? premiumRoofMat : roofMat
					const slotMaterial = isPremium ? premiumSlotMat : slotMat
					const scale = isPremium ? 1.08 : 1

					const base = new THREE.Mesh(new THREE.BoxGeometry(2.7 * scale, 0.24, 1.12 * scale), backMaterial)
					base.position.set(0, 0.11, 0)
					base.castShadow = true
					base.receiveShadow = true
					niche.add(base)

					const body = new THREE.Mesh(new THREE.BoxGeometry(2.35 * scale, 2.42, 0.86), bodyMaterial)
					body.position.set(0, 1.35, 0)
					body.castShadow = true
					body.receiveShadow = true
					niche.add(body)

					const porch = new THREE.Mesh(new THREE.BoxGeometry(2.55 * scale, 2.62, 0.12), backMaterial)
					porch.position.set(0, 1.35, labelOffset.z * 0.48)
					porch.castShadow = true
					niche.add(porch)

					if (isPremium) {
						const glassMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#dbeafe'), transparent: true, opacity: 0.32, roughness: 0.18, metalness: 0.02 })
						const glass = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.76, 0.035), glassMat)
						glass.position.set(0, 1.36, labelOffset.z * 0.72)
						niche.add(glass)
					}

					for (let row = 0; row < 5; row++) {
						for (let col = 0; col < 2; col++) {
							const slotBack = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.34, 0.08), isPremium ? premiumBackMat : shadowSlotMat)
							slotBack.position.set((col - 0.5) * 0.78, 0.58 + (4 - row) * 0.34, labelOffset.z * 0.57)
							niche.add(slotBack)

							const slot = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.24, 0.1), slotMaterial)
							slot.position.set((col - 0.5) * 0.78, 0.58 + (4 - row) * 0.34, labelOffset.z * 0.63)
							slot.castShadow = true
							niche.add(slot)

							const line = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.035, 0.12), accentMaterial)
							line.position.set((col - 0.5) * 0.78, 0.44 + (4 - row) * 0.34, labelOffset.z * 0.66)
							niche.add(line)
						}
					}

					const door = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.58, 0.12), backMaterial)
					door.position.set(0, 0.22, labelOffset.z * 0.66)
					door.castShadow = true
					niche.add(door)

					const columnGeo = new THREE.CylinderGeometry(0.075, 0.09, 1.86, 8)
					;[-1.34, 1.34].forEach((cx) => {
						const col = new THREE.Mesh(columnGeo, backMaterial)
						col.position.set(cx * scale, 1.35, labelOffset.z * 0.55)
						col.castShadow = true
						niche.add(col)
					})

					const cap = new THREE.Mesh(new THREE.BoxGeometry(2.78 * scale, 0.18, 1.02), accentMaterial)
					cap.position.set(0, 2.58, 0)
					cap.castShadow = true
					niche.add(cap)

					const roofShape = new THREE.Shape()
					roofShape.moveTo(-1.55, 0)
					roofShape.lineTo(0, 0.68)
					roofShape.lineTo(1.55, 0)
					roofShape.lineTo(-1.55, 0)
					const roofGeo = new THREE.ExtrudeGeometry(roofShape, {
						depth: 1.22,
						bevelEnabled: true,
						bevelSize: 0.025,
						bevelThickness: 0.025,
						bevelSegments: 1,
					})
					roofGeo.translate(0, 0, -0.61)
					const roof = new THREE.Mesh(roofGeo, roofMaterial)
					roof.position.set(0, 2.67, 0)
					roof.castShadow = true
					niche.add(roof)

					const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 1.32), accentMaterial)
					ridge.position.set(0, 3.38, 0)
					ridge.castShadow = true
					niche.add(ridge)

					if (isPremium) {
						const plaque = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 0.08), premiumAccentMat)
						plaque.position.set(0, 2.38, labelOffset.z * 0.72)
						plaque.castShadow = true
						niche.add(plaque)
					}

					group.add(niche)
				}

				const nicheCenters = new Map()
				markers.forEach((m) => {
					if (m?.renderMode !== 'nicheSlot') return
					const key = `${m?.sectionId || 'general'}:${m?.nicheIndex || 0}`
					if (nicheCenters.has(key)) return
					const x = Number(m?.nicheCenterX)
					const z = Number(m?.nicheCenterZ)
					if (!Number.isFinite(x) || !Number.isFinite(z)) return
					nicheCenters.set(key, {
						x,
						z,
					})
				})

				Array.from(nicheCenters.values()).forEach((n) => {
					addNiche(n.x, clamp(n.z, -bz + 2.4, bz - 3.8), 0, { x: 0, z: 1 })
				})

				scene.add(group)
			}

			function makeNicheSlot(m, idx) {
				const g = new THREE.Group()
				g.userData = { marker: m }
				const seed = stableSeedFromString(String(m?.id || idx))
				const palette = gravePalette(m)
				const wx = Number(m?.worldX)
				const wy = Number(m?.worldY)
				const wz = Number(m?.worldZ)
				const x = Number.isFinite(wx) ? wx : 0
				const y = Number.isFinite(wy) ? wy : 0.8
				const z = Number.isFinite(wz) ? wz + 0.72 : 0
				const premium = isPremiumMarker(m)

				const backMat = new THREE.MeshStandardMaterial({
					color: premium ? new THREE.Color('#241a0e') : new THREE.Color('#052e1f'),
					roughness: premium ? 0.58 : 0.86,
					metalness: premium ? 0.18 : 0.02,
				})
				const faceMat = new THREE.MeshStandardMaterial({
					color: premium ? new THREE.Color('#fff7ed') : palette.accent,
					roughness: premium ? 0.44 : 0.68,
					metalness: premium ? 0.08 : 0.02,
				})
				const innerMat = new THREE.MeshStandardMaterial({ color: palette.accent, roughness: 0.62, metalness: premium ? 0.08 : 0.02 })
				const goldMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#d6a936'), roughness: 0.38, metalness: 0.36 })
				const back = new THREE.Mesh(new THREE.BoxGeometry(premium ? 0.72 : 0.62, premium ? 0.5 : 0.44, 0.12), backMat)
				back.position.set(0, 0, 0)
				back.castShadow = true
				g.add(back)

				if (premium) {
					const halo = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.44, 0.13), goldMat)
					halo.position.set(0, 0, 0.055)
					halo.castShadow = true
					g.add(halo)
				}

				const face = new THREE.Mesh(new THREE.BoxGeometry(premium ? 0.52 : 0.48, premium ? 0.32 : 0.30, 0.14), faceMat)
				face.position.set(0, 0.02, 0.08)
				face.castShadow = true
				g.add(face)

				const stripe = new THREE.Mesh(new THREE.BoxGeometry(premium ? 0.42 : 0.34, premium ? 0.06 : 0.055, 0.16), innerMat)
				stripe.position.set(0, premium ? -0.17 : -0.16, 0.13)
				g.add(stripe)

				if (premium) {
					const topTrim = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.035, 0.17), goldMat)
					topTrim.position.set(0, 0.21, 0.14)
					g.add(topTrim)
					const leftTrim = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 0.17), goldMat)
					leftTrim.position.set(-0.285, 0.02, 0.14)
					g.add(leftTrim)
					const rightTrim = leftTrim.clone()
					rightTrim.position.x = 0.285
					g.add(rightTrim)
				}

				g.position.set(x, y, z)
				g.traverse((o) => {
					if (o.isMesh) {
						o.userData.parent = g
						clickables.push(o)
					}
				})
				graveById.set(String(m?.id || ''), g)
				scene.add(g)
			}

			function makeInstancedGraves(renderMarkers = markers) {
				const dummy = new THREE.Object3D()
				const plotGeo = new THREE.BoxGeometry(1, 1, 1)
				const soilGeo = new THREE.BoxGeometry(1, 1, 1)
				const headGeo = new THREE.BoxGeometry(1, 1, 1)
				const count = renderMarkers.length
				const plotInstMat = stoneDarkMat.clone()
				const soilInstMat = soilMat.clone()
				const headInstMat = stoneMat.clone()
				plotInstMat.vertexColors = true
				soilInstMat.vertexColors = true
				headInstMat.vertexColors = true
				const plotMesh = new THREE.InstancedMesh(plotGeo, plotInstMat, count)
				const soilMesh = new THREE.InstancedMesh(soilGeo, soilInstMat, count)
				const headMesh = new THREE.InstancedMesh(headGeo, headInstMat, count)
				plotMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
				soilMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
				headMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
				plotMesh.userData.instanceMarkers = renderMarkers
				soilMesh.userData.instanceMarkers = renderMarkers
				plotMesh.receiveShadow = true
				soilMesh.receiveShadow = true
				headMesh.castShadow = !isImmersive

				headMesh.userData.instanceMarkers = renderMarkers

				renderMarkers.forEach((m, idx) => {
					const seed = stableSeedFromString(String(m?.id || idx))
					const { x, z } = markerToXZ(m, seed)
					const hasGridPosition = m?.worldX != null && m?.worldZ != null && Number.isFinite(Number(m.worldX)) && Number.isFinite(Number(m.worldZ))
					const rot = hasGridPosition ? 0 : (stable01(seed ^ 0x9e3779b9) - 0.5) * 0.08
					const palette = gravePalette(m)

					dummy.position.set(x, 0.08, z)
					dummy.rotation.set(0, rot, 0)
					dummy.scale.set(1.32, 0.12, 2.18)
					dummy.updateMatrix()
					plotMesh.setMatrixAt(idx, dummy.matrix)
					plotMesh.setColorAt(idx, palette.plot)

					dummy.position.set(x, 0.16, z - 0.05)
					dummy.rotation.set(0, rot, 0)
					dummy.scale.set(1.02, 0.09, 1.82)
					dummy.updateMatrix()
					soilMesh.setMatrixAt(idx, dummy.matrix)
					soilMesh.setColorAt(idx, palette.soil)

					dummy.position.set(x, 0.74, z - 1.04)
					dummy.rotation.set(0, rot, 0)
					dummy.scale.set(0.58, 1.02, 0.16)
					dummy.updateMatrix()
					headMesh.setMatrixAt(idx, dummy.matrix)
					headMesh.setColorAt(idx, palette.head)

					graveById.set(String(m?.id || ''), { position: { x, z } })
				})

				plotMesh.instanceMatrix.needsUpdate = true
				soilMesh.instanceMatrix.needsUpdate = true
				headMesh.instanceMatrix.needsUpdate = true
				if (plotMesh.instanceColor) plotMesh.instanceColor.needsUpdate = true
				if (soilMesh.instanceColor) soilMesh.instanceColor.needsUpdate = true
				if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true
				clickables.push(plotMesh, soilMesh, headMesh)
				scene.add(plotMesh, soilMesh, headMesh)
			}

			function makeGrave(m, idx) {
				const g = new THREE.Group()
				g.userData = { marker: m }

				const seed = stableSeedFromString(String(m?.id || idx))
				const style = seed % 5

				const palette = gravePalette(m)
				const accentMat = statusMaterial(palette.accent, 0.62)
				const plotMat = statusMaterial(palette.plot, 0.86)
				const soilStateMat = statusMaterial(palette.soil, 0.96)
				const headStateMat = statusMaterial(palette.head, 0.84)

				// Base del lote (concreto) + tierra
				const plot = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.10, 3.15), plotMat)
				plot.position.y = 0.05
				plot.receiveShadow = true
				g.add(plot)

				const soilPatch = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 2.75), soilStateMat)
				soilPatch.position.set(0, 0.09, -0.05)
				soilPatch.receiveShadow = true
				g.add(soilPatch)

				const statusStrip = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.08, 0.24), accentMat)
				statusStrip.position.set(0, 0.19, 1.26)
				statusStrip.castShadow = true
				g.add(statusStrip)

				// Sombra suave (fake) para “asentar” la tumba (sin oscurecer mucho)
				const contact = new THREE.Mesh(new THREE.CircleGeometry(1.1, 28), shadowMat)
				contact.rotation.x = -Math.PI / 2
				contact.position.y = 0.011
				g.add(contact)

				function makeHeadstoneRounded(w, h, t) {
					const shape = new THREE.Shape()
					const r = Math.min(w, h) * 0.22
					shape.moveTo(-w / 2, 0)
					shape.lineTo(-w / 2, h - r)
					shape.quadraticCurveTo(-w / 2, h, -w / 2 + r, h)
					shape.lineTo(w / 2 - r, h)
					shape.quadraticCurveTo(w / 2, h, w / 2, h - r)
					shape.lineTo(w / 2, 0)
					shape.lineTo(-w / 2, 0)
					const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 2, steps: 1 })
					geo.translate(0, 0, -t / 2)
					return geo
				}

				if (style === 0) {
					// Cruz
					const stem = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.25, 0.16), headStateMat)
					stem.position.set(0, 0.78, -1.2)
					stem.castShadow = true
					g.add(stem)
					const arm = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.18, 0.16), plotMat)
					arm.position.set(0, 1.17, -1.2)
					arm.castShadow = true
					g.add(arm)
					const plate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.26, 0.06), accentMat)
					plate.position.set(0, 0.58, -1.07)
					plate.castShadow = true
					g.add(plate)
				} else if (style === 1) {
					// Lápida redondeada con base
					const base = new THREE.Mesh(new THREE.BoxGeometry(0.98, 0.22, 0.52), plotMat)
					base.position.set(0, 0.22, -1.18)
					base.castShadow = true
					g.add(base)
					const head = new THREE.Mesh(makeHeadstoneRounded(0.92, 1.35, 0.18), headStateMat)
					head.position.set(0, 0.32, -1.2)
					head.castShadow = true
					g.add(head)
					const badge = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.22, 0.06), accentMat)
					badge.position.set(0, 0.88, -1.05)
					badge.castShadow = true
					g.add(badge)
				} else if (style === 2) {
					// Obelisco con aro
					const pts = []
					pts.push(new THREE.Vector2(0.0, 0))
					pts.push(new THREE.Vector2(0.34, 0))
					pts.push(new THREE.Vector2(0.28, 0.76))
					pts.push(new THREE.Vector2(0.14, 1.55))
					pts.push(new THREE.Vector2(0.0, 1.8))
					const obel = new THREE.Mesh(new THREE.LatheGeometry(pts, 10), headStateMat)
					obel.rotation.y = Math.PI / 8
					obel.position.set(0, 0.18, -1.22)
					obel.castShadow = true
					g.add(obel)
					const ring = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.075, 12, 28), accentMat)
					ring.position.set(0, 0.96, -1.22)
					ring.rotation.x = Math.PI / 2
					ring.castShadow = true
					g.add(ring)
				} else if (style === 3) {
					// Losa horizontal + cabecera
					const slab = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, 1.75), headStateMat)
					slab.position.set(0, 0.18, -0.75)
					slab.castShadow = true
					g.add(slab)
					const head = new THREE.Mesh(makeHeadstoneRounded(0.82, 0.98, 0.16), plotMat)
					head.position.set(0, 0.24, -1.34)
					head.castShadow = true
					g.add(head)
					const badge = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.22, 0.06), accentMat)
					badge.position.set(0, 0.58, -1.2)
					badge.castShadow = true
					g.add(badge)
				} else {
					// Doble lápida (familia)
					const base = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.18, 0.62), plotMat)
					base.position.set(0, 0.20, -1.18)
					base.castShadow = true
					g.add(base)
					const left = new THREE.Mesh(makeHeadstoneRounded(0.52, 1.15, 0.14), headStateMat)
					left.position.set(-0.30, 0.30, -1.18)
					left.castShadow = true
					g.add(left)
					const right = new THREE.Mesh(makeHeadstoneRounded(0.52, 1.15, 0.14), headStateMat)
					right.position.set(0.30, 0.30, -1.18)
					right.castShadow = true
					g.add(right)
					const cap = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.12, 0.16), accentMat)
					cap.position.set(0, 1.35, -1.18)
					cap.castShadow = true
					g.add(cap)
				}

				const { x, z } = markerToXZ(m, seed)
				g.position.set(x, 0, z)
				const hasGridPosition = m?.worldX != null && m?.worldZ != null && Number.isFinite(Number(m.worldX)) && Number.isFinite(Number(m.worldZ))
				g.rotation.y = hasGridPosition ? 0 : (stable01(seed ^ 0x9e3779b9) - 0.5) * 0.12
				g.rotation.z = hasGridPosition ? 0 : (stable01(seed ^ 0x85ebca6b) - 0.5) * 0.02

				graveById.set(String(m?.id || ''), g)

				// Clickables: todas las meshes del grupo excepto la sombra de contacto.
				g.traverse((o) => {
					if (o.isMesh && o !== contact) {
						o.userData.parent = g
						clickables.push(o)
					}
				})

				gravestones.push(g)
				scene.add(g)
			}

			addSectionGuides()
			addNichesForSections()
			const nicheMarkers = markers.filter((m) => m?.renderMode === 'nicheSlot')
			const groundMarkers = markers.filter((m) => m?.renderMode !== 'nicheSlot')
			nicheMarkers.forEach((m, i) => makeNicheSlot(m, i))
			if (groundMarkers.length >= 80) makeInstancedGraves(groundMarkers)
			else groundMarkers.forEach((m, i) => makeGrave(m, i))

			// Muros perimetrales + portón de entrada (estilo low-poly como la referencia)
			const walls = new THREE.Group()
			const wallMat = new THREE.MeshStandardMaterial({ color: stone.clone().offsetHSL(0, 0, -0.03), roughness: 0.92, metalness: 0.0 })
			const wallH = 2.25
			const wallT = 0.75
			const gateOpening = 4.6
			const gateZ = bz + wallT / 2
			const backZ = -bz - wallT / 2
			const sideX = bx + wallT / 2

			function addWallBox(w, h, d, x, y, z) {
				const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat)
				m.position.set(x, y, z)
				m.castShadow = true
				m.receiveShadow = true
				walls.add(m)
				return m
			}

			// Laterales
			addWallBox(wallT, wallH, bz * 2 + wallT * 2, sideX, wallH / 2, 0)
			addWallBox(wallT, wallH, bz * 2 + wallT * 2, -sideX, wallH / 2, 0)
			// Fondo completo
			addWallBox(bx * 2 + wallT * 2, wallH, wallT, 0, wallH / 2, backZ)
			// Frente con apertura del portón
			const frontW = bx * 2 + wallT * 2
			const leftW = (frontW - gateOpening) / 2
			addWallBox(leftW, wallH, wallT, -(gateOpening / 2 + leftW / 2), wallH / 2, gateZ)
			addWallBox(leftW, wallH, wallT, gateOpening / 2 + leftW / 2, wallH / 2, gateZ)

			// Pilares en esquinas
			const pillarMat = new THREE.MeshStandardMaterial({ color: stoneDark.clone().offsetHSL(0, 0.01, -0.06), roughness: 0.9, metalness: 0.02 })
			const pillarGeo = new THREE.BoxGeometry(1.0, 2.65, 1.0)
			const cornerPillars = [
				[bx + wallT / 2, gateZ],
				[-bx - wallT / 2, gateZ],
				[bx + wallT / 2, backZ],
				[-bx - wallT / 2, backZ],
			]
			cornerPillars.forEach(([x, z]) => {
				const p = new THREE.Mesh(pillarGeo, pillarMat)
				p.position.set(x, 1.325, z)
				p.castShadow = true
				p.receiveShadow = true
				walls.add(p)
			})

			scene.add(walls)

			// Portón (barras)
			const gate = new THREE.Group()
			const gPillarGeo = new THREE.BoxGeometry(0.95, 2.85, 0.95)
			const gPillarL = new THREE.Mesh(gPillarGeo, pillarMat)
			gPillarL.position.set(-gateOpening / 2, 1.425, gateZ)
			gPillarL.castShadow = true
			gate.add(gPillarL)
			const gPillarR = new THREE.Mesh(gPillarGeo, pillarMat)
			gPillarR.position.set(gateOpening / 2, 1.425, gateZ)
			gPillarR.castShadow = true
			gate.add(gPillarR)
			const gBeam = new THREE.Mesh(new THREE.BoxGeometry(gateOpening + 1.3, 0.28, 0.95), pillarMat)
			gBeam.position.set(0, 2.85, gateZ)
			gBeam.castShadow = true
			gate.add(gBeam)

			const barMat = new THREE.MeshStandardMaterial({ color: metal.clone().offsetHSL(0, 0, -0.08), roughness: 0.55, metalness: 0.35 })
			const barGeo = new THREE.BoxGeometry(0.08, 1.55, 0.08)
			const barCount = 18
			for (let i = 0; i < barCount; i++) {
				const t = (i + 0.5) / barCount
				const x = -gateOpening / 2 + t * gateOpening
				const b = new THREE.Mesh(barGeo, barMat)
				b.position.set(x, 0.9, gateZ)
				b.castShadow = true
				gate.add(b)
			}
			scene.add(gate)

			// Faroles a lo largo del camino principal
			const lamps = new THREE.Group()
			const postMat = new THREE.MeshStandardMaterial({ color: metal.clone().offsetHSL(0, 0, -0.06), roughness: 0.62, metalness: 0.22 })
			const lampHeadMat = new THREE.MeshStandardMaterial({
				color: new THREE.Color('#fff6d6'),
				emissive: new THREE.Color('#ffe2a8'),
				emissiveIntensity: 0.55,
				roughness: 0.65,
				metalness: 0.05,
			})
			const post = new THREE.CylinderGeometry(0.12, 0.14, 2.25, 10)
			const head = new THREE.BoxGeometry(0.38, 0.28, 0.38)
			const zList = [7.2, 3.2, -0.8, -4.8]
			zList.forEach((z) => {
				[-2.2, 2.2].forEach((x) => {
					const p = new THREE.Mesh(post, postMat)
					p.position.set(x, 1.125, z)
					p.castShadow = true
					lamps.add(p)
					const h = new THREE.Mesh(head, lampHeadMat)
					h.position.set(x, 2.35, z)
					h.castShadow = true
					lamps.add(h)
					const light = new THREE.PointLight(0xfff2c7, 0.32, 10.5, 2)
					light.position.set(x, 2.35, z)
					lamps.add(light)
				})
			})
			scene.add(lamps)

			// Capilla/mausoleo al fondo
			const chapel = new THREE.Group()
			const chapelX = -6.5
			const chapelZ = -bz + 3.6
			const baseGeo = new THREE.BoxGeometry(6.2, 2.55, 4.2)
			const baseMesh = new THREE.Mesh(baseGeo, stoneMat)
			baseMesh.position.set(chapelX, 1.275, chapelZ)
			baseMesh.castShadow = true
			baseMesh.receiveShadow = true
			chapel.add(baseMesh)
			const roofGeo = new THREE.ConeGeometry(3.9, 1.7, 4)
			const roofMat = new THREE.MeshStandardMaterial({ color: stoneDark.clone().offsetHSL(0, 0.02, -0.05), roughness: 0.9, metalness: 0.02 })
			const roof = new THREE.Mesh(roofGeo, roofMat)
			roof.position.set(chapelX, 3.2, chapelZ)
			roof.rotation.y = Math.PI / 4
			roof.castShadow = true
			chapel.add(roof)
			const door = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.1), new THREE.MeshStandardMaterial({ color: metal.clone().offsetHSL(0, 0.05, -0.1), roughness: 0.8, metalness: 0.15 }))
			door.position.set(chapelX, 0.95, chapelZ + 2.15)
			door.castShadow = true
			chapel.add(door)
			const steps = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.22, 1.2), stoneDarkMat)
			steps.position.set(chapelX, 0.11, chapelZ + 2.9)
			steps.receiveShadow = true
			chapel.add(steps)
			scene.add(chapel)

			// Un pequeño monumento al centro
			const monument = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.85, 1.6, 10), stoneDarkMat)
			monument.position.set(2.8, 0.8, -2.8)
			monument.castShadow = true
			monument.receiveShadow = true
			scene.add(monument)

			// Árboles low-poly alrededor del perímetro (tipo ciprés)
			const trees = new THREE.Group()
			const trunkMat = new THREE.MeshStandardMaterial({ color: soil.clone().offsetHSL(0, 0.08, -0.18), roughness: 0.95, metalness: 0.0 })
			const leafMat = new THREE.MeshStandardMaterial({ color: grassA.clone().offsetHSL(0, 0.10, -0.04), roughness: 0.92, metalness: 0.0 })
			const broadLeafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#4f8f55'), roughness: 0.92, metalness: 0.0 })
			const shrubLeafMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2f6f3e'), roughness: 0.94, metalness: 0.0 })
			const trunkGeo = new THREE.CylinderGeometry(0.10, 0.14, 1.1, 8)
			const leafGeo = new THREE.ConeGeometry(0.48, 1.75, 10)
			const positions = [
				[-bx - 1.5, -bz - 1.0],
				[bx + 1.5, -bz - 1.0],
				[-bx - 1.5, bz + 1.0],
				[bx + 1.5, bz + 1.0],
			]
			for (let i = 0; i < 10; i++) {
				const t = i / 9
				positions.push([-bx - 1.7, -bz + t * bz * 2])
				positions.push([bx + 1.7, -bz + t * bz * 2])
			}
			for (let i = 0; i < 12; i++) {
				const t = i / 11
				const x = -bx + 3.5 + t * (bx * 2 - 7)
				if (Math.abs(x) > 3.8) {
					positions.push([x, -bz - 1.6])
					positions.push([x, bz + 1.6])
				}
			}
			;[
				[-4.4, 12.2],
				[4.4, 12.2],
				[-4.4, 6.4],
				[4.4, 6.4],
				[-11.2, -10.8],
				[11.2, -10.8],
				[-21.2, -2.4],
				[21.2, -2.4],
			].forEach((p) => positions.push(p))
			positions.forEach(([x, z], i) => {
				const s = 0.9 + stable01(i * 10007) * 0.35
				const trunk = new THREE.Mesh(trunkGeo, trunkMat)
				trunk.position.set(x, 0.55, z)
				trunk.castShadow = true
				trees.add(trunk)
				if (i % 3 === 0) {
					const crown = new THREE.Mesh(new THREE.SphereGeometry(0.68, 10, 7), broadLeafMat)
					crown.position.set(x, 1.45 * s, z)
					crown.scale.set(1.2 * s, 0.82 * s, 1.05 * s)
					crown.castShadow = true
					trees.add(crown)
				} else {
					const leaf = new THREE.Mesh(leafGeo, leafMat)
					leaf.position.set(x, 1.65 * s, z)
					leaf.scale.setScalar(s)
					leaf.castShadow = true
					trees.add(leaf)
				}
				if (i % 2 === 0) {
					const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 5), shrubLeafMat)
					shrub.position.set(x + (stable01(i * 41) - 0.5) * 1.2, 0.32, z + (stable01(i * 43) - 0.5) * 1.2)
					shrub.scale.set(1.35, 0.55, 1.0)
					trees.add(shrub)
				}
			})
			scene.add(trees)

			// Indicador de selección (aro)
			const ringColor = grassA.clone().offsetHSL(0, 0.08, 0.06)
			const ringEmissive = grassA.clone().offsetHSL(0, 0.12, -0.06)
			const selectRingMat = new THREE.MeshStandardMaterial({
				color: ringColor,
				emissive: ringEmissive,
				emissiveIntensity: 0.65,
				transparent: true,
				opacity: 0.65,
				roughness: 0.9,
				metalness: 0.0,
			})
			const selectRing = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.18, 40), selectRingMat)
			selectRing.rotation.x = -Math.PI / 2
			selectRing.position.y = 0.015
			selectRing.visible = false
			scene.add(selectRing)

			const raycaster = new THREE.Raycaster()
			const mouse = new THREE.Vector2()
			let isDragging = false
			let prev = { x: 0, y: 0 }

			function requestRender() {
				needsRender = true
				if (isRunning) return
				isRunning = true
				rafRef.current = window.requestAnimationFrame(loop)
			}

			function resize() {
				const w = root.clientWidth
				const h = root.clientHeight
				renderer.setSize(w, h, false)
				camera.aspect = w / h
				camera.updateProjectionMatrix()
				requestRender()
			}

			const ro = new ResizeObserver(() => resize())
			ro.observe(root)
			resize()

			function setFromEvent(e) {
				const rect = canvas.getBoundingClientRect()
				const x = ((e.clientX - rect.left) / rect.width) * 2 - 1
				const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1)
				mouse.set(x, y)
			}

			function onDown(e) {
				isDragging = true
				prev = { x: e.clientX, y: e.clientY }
				requestRender()
			}
			function onUp() {
				isDragging = false
			}
			function onMove(e) {
				if (!isDragging) return
				const dx = e.clientX - prev.x
				const dy = e.clientY - prev.y
				targetTheta -= dx * 0.008
				targetPhi = clamp(targetPhi + dy * 0.006, 0.12, 1.1)
				prev = { x: e.clientX, y: e.clientY }
				requestRender()
			}
			function onWheel(e) {
				e.preventDefault()
				targetRadius = clamp(targetRadius + e.deltaY * 0.03, 10, isImmersive ? 68 : 74)
				requestRender()
			}

			controlsRef.current = {
				reset: () => {
					targetTheta = 0
					targetPhi = 0.35
					targetRadius = isImmersive ? 34 : 38
					requestRender()
				},
				toggleFog: () => {
					fogEnabled = !fogEnabled
					try {
						if (!scene.fog) {
							const fogColor = scene.background ? scene.background.clone() : new THREE.Color('#050a08')
							scene.fog = new THREE.FogExp2(fogColor.getHex(), fogEnabled ? 0.045 : 0.0)
						} else {
							scene.fog.density = fogEnabled ? 0.045 : 0.0
						}
					} catch {
						// ignore
					}
					requestRender()
					return fogEnabled
				},
				nudge: (action) => {
					const stepTheta = 0.28
					const stepPhi = 0.16
					const stepZoom = 5.5
					if (action === 'left') targetTheta += stepTheta
					if (action === 'right') targetTheta -= stepTheta
					if (action === 'up') targetPhi = clamp(targetPhi - stepPhi, 0.12, 1.1)
					if (action === 'down') targetPhi = clamp(targetPhi + stepPhi, 0.12, 1.1)
					if (action === 'zoomIn') targetRadius = clamp(targetRadius - stepZoom, 10, isImmersive ? 68 : 74)
					if (action === 'zoomOut') targetRadius = clamp(targetRadius + stepZoom, 10, isImmersive ? 68 : 74)
					requestRender()
				},
				requestRender,
			}

			function onClick(e) {
				setFromEvent(e)
				raycaster.setFromCamera(mouse, camera)
				const hits = raycaster.intersectObjects(clickables)
				if (hits.length > 0) {
					const instanceMarkers = hits[0].object?.userData?.instanceMarkers
					if (instanceMarkers && hits[0].instanceId != null) {
						const m = instanceMarkers[hits[0].instanceId]
						if (m) {
							pickedKeyRef.current = String(m?.id || '')
							setPicked(m)
							onSelect?.(m.record)
							requestRender()
							return
						}
					}
					const g = hits[0].object?.userData?.parent
					const m = g?.userData?.marker
					if (m) {
						pickedKeyRef.current = String(m?.id || '')
						setPicked(m)
						onSelect?.(m.record)
						requestRender()
						return
					}
				}
				pickedKeyRef.current = ''
				setPicked(null)
				requestRender()
			}

			canvas.addEventListener('mousedown', onDown)
			window.addEventListener('mouseup', onUp)
			window.addEventListener('mousemove', onMove)
			canvas.addEventListener('wheel', onWheel, { passive: false })
			canvas.addEventListener('click', onClick)

			function loop() {
				const speed = isImmersive ? 0.12 : 0.07
				theta += (targetTheta - theta) * speed
				phi += (targetPhi - phi) * speed
				radius += (targetRadius - radius) * speed
				camera.position.x = radius * Math.sin(theta) * Math.cos(phi)
				camera.position.y = radius * Math.sin(phi)
				camera.position.z = radius * Math.cos(theta) * Math.cos(phi)
				camera.lookAt(0, 0.9, 0)

				const moving =
					Math.abs(targetTheta - theta) > 0.0008 ||
					Math.abs(targetPhi - phi) > 0.0008 ||
					Math.abs(targetRadius - radius) > 0.002

				const key = pickedKeyRef.current
				if (key) {
					const g = graveById.get(String(key))
					if (g) {
						selectRing.visible = true
						selectRing.position.x = g.position.x
						selectRing.position.z = g.position.z
						selectRing.rotation.z += 0.004
					} else {
						selectRing.visible = false
					}
				} else {
					selectRing.visible = false
				}

				if (needsRender || moving || isDragging) {
					needsRender = false
					renderer.render(scene, camera)
				}

				if (needsRender || moving || isDragging) {
					rafRef.current = window.requestAnimationFrame(loop)
				} else {
					isRunning = false
				}
			}
			requestRender()

			cleanupRef.current = () => {
				try {
					window.cancelAnimationFrame(rafRef.current)
				} catch {
					// ignore
				}
				try {
					canvas.removeEventListener('mousedown', onDown)
					window.removeEventListener('mouseup', onUp)
					window.removeEventListener('mousemove', onMove)
					canvas.removeEventListener('wheel', onWheel)
					canvas.removeEventListener('click', onClick)
				} catch {
					// ignore
				}
				try {
					ro.disconnect()
				} catch {
					// ignore
				}
				try {
					const disposedGeos = new Set()
					const disposedMats = new Set()
					const disposedTex = new Set()
					function disposeMaterial(mat) {
						if (!mat || disposedMats.has(mat)) return
						disposedMats.add(mat)
						for (const k of Object.keys(mat)) {
							const v = mat[k]
							if (v && v.isTexture && typeof v.dispose === 'function' && !disposedTex.has(v)) {
								disposedTex.add(v)
								v.dispose()
							}
						}
						if (typeof mat.dispose === 'function') mat.dispose()
					}
					scene.traverse((o) => {
						const geo = o.geometry
						if (geo && typeof geo.dispose === 'function' && !disposedGeos.has(geo)) {
							disposedGeos.add(geo)
							geo.dispose()
						}
						const mat = o.material
						if (Array.isArray(mat)) mat.forEach(disposeMaterial)
						else disposeMaterial(mat)
					})
				} catch {
					// ignore
				}
				try {
					renderer.dispose()
				} catch {
					// ignore
				}
				cleanupRef.current = null
			}
		}

		init().catch((e) => {
			if (cancelled) return
			setUiError(e?.message || 'No se pudo iniciar la vista 3D.')
		})

		return () => {
			cancelled = true
			try {
				cleanupRef.current?.()
			} catch {
				// ignore
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [markers, sections, isImmersive])

	function onResetCam() {
		try {
			controlsRef.current?.reset?.()
		} catch {
			// ignore
		}
	}

	function onToggleFog() {
		try {
			const next = controlsRef.current?.toggleFog?.()
			setFogOn(!!next)
		} catch {
			// ignore
		}
	}

	function onNudgeCamera(action) {
		try {
			controlsRef.current?.nudge?.(action)
		} catch {
			// ignore
		}
	}

	function ControlButton({ action, label, className = '' }) {
		return (
			<button
				type="button"
				onClick={() => onNudgeCamera(action)}
				aria-label={label}
				title={label}
				className={
					'inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-md border border-white/15 bg-black/35 text-sm font-bold text-[color:var(--text-h)] shadow-sm backdrop-blur transition hover:bg-black/50 active:scale-95 ' +
					className
				}
			>
				{label}
			</button>
		)
	}

	if (isImmersive) {
		return (
			<div className="theme-dark overflow-hidden rounded-md border border-[color:var(--border)]" style={{ background: 'var(--nav-gradient)' }}>
				<div ref={rootRef} className="relative overflow-hidden bg-black/10">
					<canvas ref={canvasRef} className="block h-[72svh] w-full cursor-grab touch-none md:h-[78svh]" />

					{/* Overlay UI (estilo mapaInteractivo) */}
					<div className="pointer-events-none absolute inset-0">
						<div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-3 px-4 py-4">
							<div className="text-xs tracking-[0.30em] uppercase text-[color:var(--text)]">
								<div className="text-sm tracking-[0.18em]">
									<span className="bg-[var(--btn-gradient)] bg-clip-text text-transparent">Cementerio</span>
								</div>
								<div className="mt-1 text-[color:var(--text-h)]">
									<span className="font-semibold">Campo Santo</span> · {markers.length} tumbas · {sectionSummary.count} secciones
								</div>
							</div>

							<div className="text-right text-[11px] tracking-[0.22em] text-[color:var(--muted)]">
								Arrastra · Rotar
								<br />
								Scroll · Zoom
								<br />
								Clic · Explorar
							</div>
						</div>

						<div className="absolute left-4 top-24 max-w-[calc(100%-2rem)] rounded-md border border-[color:var(--border)] bg-black/35 px-3 py-2 backdrop-blur">
							<div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] font-medium text-[color:var(--text-h)]">
								{graveStateLegend.map((item) => (
									<span key={item.state} className="inline-flex items-center gap-1.5">
										<span className="h-2.5 w-2.5 rounded-full border border-white/40" style={{ backgroundColor: item.color }} />
										{item.label}
									</span>
								))}
							</div>
						</div>

						<div className="pointer-events-auto absolute bottom-16 left-4 rounded-md border border-[color:var(--border)] bg-black/35 p-2 backdrop-blur md:bottom-20">
							<div className="grid grid-cols-3 gap-1">
								<div />
								<ControlButton action="up" label="↑" />
								<div />
								<ControlButton action="left" label="←" />
								<button
									type="button"
									onClick={onResetCam}
									aria-label="Centrar cámara"
									title="Centrar cámara"
									className="inline-flex h-10 w-10 touch-manipulation items-center justify-center rounded-md border border-white/15 bg-black/45 text-[11px] font-bold tracking-[0.12em] text-[color:var(--text-h)] shadow-sm backdrop-blur transition hover:bg-black/55 active:scale-95"
								>
									• 
								</button>
								<ControlButton action="right" label="→" />
								<div />
								<ControlButton action="down" label="↓" />
								<div />
							</div>
							<div className="mt-2 grid grid-cols-2 gap-1">
								<ControlButton action="zoomIn" label="+" className="w-full" />
								<ControlButton action="zoomOut" label="−" className="w-full" />
							</div>
						</div>

						<div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 px-4 py-4">
							<div className="max-w-[320px] text-xs italic leading-6 text-[color:var(--muted)]">
								"La muerte no es nada.\nSolo pasé a la habitación de al lado."
							</div>
							<div className="pointer-events-auto flex items-center gap-2">
								<button
									type="button"
									onClick={onResetCam}
									className="h-9 rounded-md border border-[color:var(--border)] bg-black/25 px-3 text-xs font-medium tracking-[0.18em] text-[color:var(--text-h)] hover:bg-black/35"
								>
									↺ Reset
								</button>
								<button
									type="button"
									onClick={onToggleFog}
									className="h-9 rounded-md border border-[color:var(--border)] bg-black/25 px-3 text-xs font-medium tracking-[0.18em] text-[color:var(--text-h)] hover:bg-black/35"
								>
									☾ Niebla {fogOn ? 'On' : 'Off'}
								</button>
							</div>
						</div>

						{pickedLabel ? (
							<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[120%]">
								<div className="rounded-md border border-[color:var(--border)] bg-black/55 px-4 py-3 text-center backdrop-blur">
									<div className="text-sm font-semibold text-[color:var(--text-h)]">{pickedLabel.name}</div>
									<div className="mt-1 text-[11px] tracking-[0.22em] text-[color:var(--muted)]">
										{pickedLabel.years || '—'}
									</div>
									<div className="mt-2 text-xs text-[color:var(--text)]">
										{pickedLabel.grave ? `Tumba ${pickedLabel.grave}` : ''}
										{pickedLabel.sector ? ` · ${pickedLabel.sector}` : ''}
										{pickedLabel.row ? ` · Fila ${pickedLabel.row}` : ''}
										{pickedLabel.col ? ` · Col ${pickedLabel.col}` : ''}
									</div>
									<div className="mt-2 inline-flex rounded-full border border-white/20 px-2 py-1 text-[11px] font-semibold text-[color:var(--text-h)]">
										Estado: {pickedLabel.status}
									</div>
								</div>
							</div>
						) : null}

						{uiError ? (
							<div className="absolute left-0 right-0 top-16 px-4 text-xs text-red-300">{uiError}</div>
						) : null}
					</div>
				</div>
			</div>
		)
	}

	return (
		<div className="ui-card rounded-md p-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<div className="ui-kicker">Mapa</div>
					<div className="mt-0.5 text-sm font-semibold text-[color:var(--text-h)]">Vista 3D (clara)</div>
					<div className="mt-1 text-xs text-[color:var(--text)]">Arrastra para rotar · Scroll para zoom · {sectionSummary.count} secciones · {sectionSummary.first}.</div>
					{uiError ? <div className="mt-1 text-xs text-red-600">{uiError}</div> : null}
				</div>

				{pickedLabel ? (
					<div className="rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-xs text-[color:var(--text)]">
						<div className="font-semibold text-[color:var(--text-h)]">{pickedLabel.name}</div>
						<div className="mt-0.5">
							{pickedLabel.years ? <span className="ui-kicker">{pickedLabel.years}</span> : null}
							{pickedLabel.grave ? <span className={pickedLabel.years ? 'ml-2' : ''}>Tumba {pickedLabel.grave}</span> : null}
							{pickedLabel.sector ? <span className="ml-2">{pickedLabel.sector}</span> : null}
							{pickedLabel.row ? <span className="ml-2">Fila {pickedLabel.row}</span> : null}
							{pickedLabel.col ? <span className="ml-2">Col {pickedLabel.col}</span> : null}
						</div>
					</div>
				) : (
					<div className="text-xs text-[color:var(--text)]">{markers.length ? `${markers.length} difuntos en escena.` : 'Sin difuntos para mostrar.'}</div>
				)}
			</div>

			<div ref={rootRef} className="mt-3 overflow-hidden rounded-md border border-[color:var(--border)] bg-[color:var(--surface-2)]">
				<canvas ref={canvasRef} className="block h-[420px] w-full" />
			</div>
		</div>
	)
}
