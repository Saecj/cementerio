const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildGravesPublicRouter } = require('../graves.public.routes');

describe('graves/graves.public.routes', () => {
	test('GET /api/client/grave-map: retorna vacío si no hay sectores', async () => {
		db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		const app = makeTestApp({ router: buildGravesPublicRouter() });
		const res = await request(app).get('/api/client/grave-map');

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, sectors: [], sectorId: null, graves: [] });
		expect(db.query).toHaveBeenCalledTimes(1);
	});
});
