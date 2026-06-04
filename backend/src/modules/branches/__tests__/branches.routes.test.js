const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildBranchesRouter } = require('../branches.routes');

describe('branches/branches.routes', () => {
	test('GET /api/client/branches: lista pública', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Sede A' }] });

		const app = makeTestApp({ router: buildBranchesRouter() });
		const res = await request(app).get('/api/client/branches');

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.branches).toEqual([{ id: 1, name: 'Sede A' }]);
		expect(db.query).toHaveBeenCalledTimes(1);
	});

	test('GET /api/admin/branches: 403 si employee sin permiso', async () => {
		const app = makeTestApp({ router: buildBranchesRouter() });
		const res = await request(app)
			.get('/api/admin/branches')
			.set('x-test-user', JSON.stringify({ id: 10, role: 'employee', permissions: [] }));

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
	});
});
