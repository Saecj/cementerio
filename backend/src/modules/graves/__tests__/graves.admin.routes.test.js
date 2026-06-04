const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildGravesAdminRouter } = require('../graves.admin.routes');

describe('graves/graves.admin.routes', () => {
	test('GET /api/admin/grave-types: 403 si admin restringido no tiene permiso graves', async () => {
		const app = makeTestApp({ router: buildGravesAdminRouter() });
		const res = await request(app)
			.get('/api/admin/grave-types')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin', permissions: [] }));

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('POST /api/admin/graves: valida STATUS_INVALID sin DB', async () => {
		const app = makeTestApp({ router: buildGravesAdminRouter() });
		const res = await request(app)
			.post('/api/admin/graves')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ status: 'nope', priceCents: 1000 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'STATUS_INVALID' });
		expect(db.query).not.toHaveBeenCalled();
		expect(db.withTransaction).not.toHaveBeenCalled();
	});

	test('PATCH /api/admin/graves/:id: valida ID_INVALID', async () => {
		const app = makeTestApp({ router: buildGravesAdminRouter() });
		const res = await request(app)
			.patch('/api/admin/graves/nope')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ status: 'available' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'ID_INVALID' });
	});
});
