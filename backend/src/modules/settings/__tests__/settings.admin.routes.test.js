const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
}));

const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildSettingsAdminRouter } = require('../settings.admin.routes');

describe('settings/settings.admin.routes', () => {
	test('GET /api/google-maps-key: 404 si no está configurada', async () => {
		const previous = process.env.GOOGLE_MAPS_API_KEY;
		process.env.GOOGLE_MAPS_API_KEY = '';

		try {
			const app = makeTestApp({ router: buildSettingsAdminRouter() });
			const res = await request(app)
				.get('/api/google-maps-key')
				.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }));

			expect(res.status).toBe(404);
			expect(res.body).toEqual({ ok: false, error: 'NOT_CONFIGURED' });
		} finally {
			process.env.GOOGLE_MAPS_API_KEY = previous;
		}
	});

	test('PUT /api/cemetery-location: valida COORDS_INCOMPLETE', async () => {
		const app = makeTestApp({ router: buildSettingsAdminRouter() });
		const res = await request(app)
			.put('/api/cemetery-location')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ latitude: 10.1 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'COORDS_INCOMPLETE' });
	});
});
