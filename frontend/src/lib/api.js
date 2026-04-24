export async function api(path, options) {
	const response = await fetch(path, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...(options?.headers || {}),
		},
		credentials: 'include',
	})
	const data = await response.json().catch(() => null)
	return { ok: response.ok, status: response.status, data }
}
