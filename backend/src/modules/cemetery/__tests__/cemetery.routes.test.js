const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildCemeteryRouter } = require('../cemetery.routes');

describe('cemetery/cemetery.routes', () => {
	test('GET /api/search: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildCemeteryRouter() });
		const res = await request(app).get('/api/search?q=xx');

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('GET /api/search: valida query corta (QUERY_TOO_SHORT) sin DB', async () => {
		const app = makeTestApp({ router: buildCemeteryRouter() });
		const res = await request(app)
			.get('/api/search?q=a')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'visitor' }));

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'QUERY_TOO_SHORT' });
		expect(db.query).not.toHaveBeenCalled();
	});
});
