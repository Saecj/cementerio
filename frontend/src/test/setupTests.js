import '@testing-library/jest-dom'

// Ayuda: evita fallos si algún componente hace fetch directo.
if (!global.fetch) {
	global.fetch = async () => ({
		ok: true,
		status: 200,
		json: async () => ({}),
	})
}
