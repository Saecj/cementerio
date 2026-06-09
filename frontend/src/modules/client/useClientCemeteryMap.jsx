import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { normalizeMapPayload } from './mapUtils'

export function useClientCemeteryMap(me) {
	const [state, setState] = useState({
		loading: false,
		error: '',
		items: [],
		markers: [],
		sectors: [],
		source: '',
	})

	useEffect(() => {
		let cancelled = false
		async function load() {
			if (!me) {
				setState({ loading: false, error: '', items: [], markers: [], sectors: [], source: '' })
				return
			}
			setState((s) => ({ ...s, loading: true, error: '' }))
			let res = await api('/api/client/cemetery-map')
			if (cancelled) return
			if (!res.ok) {
				res = await api('/api/client/reservations')
				if (cancelled) return
			}
			if (!res.ok) {
				setState({ loading: false, error: 'No se pudo cargar el mapa del cementerio.', items: [], markers: [], sectors: [], source: '' })
				return
			}
			const next = normalizeMapPayload(res.data)
			setState({ loading: false, error: '', ...next })
		}
		load()
		return () => {
			cancelled = true
		}
	}, [me])

	return state
}
