const request = require('supertest');

jest.mock('../settings.store', () => ({
	getSetting: jest.fn(),
}));

const { getSetting } = require('../settings.store');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildSettingsPublicRouter } = require('../settings.public.routes');

describe('settings/settings.public.routes', () => {
	test('GET /api/public/cemetery-location: normaliza campos', async () => {
		getSetting.mockResolvedValueOnce(null);

		const app = makeTestApp({ router: buildSettingsPublicRouter() });
		const res = await request(app).get('/api/public/cemetery-location');

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.location).toEqual({
			name: null,
			address: null,
			latitude: null,
			longitude: null,
			updated_at: null,
		});
	});
});
