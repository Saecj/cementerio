const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildBurialsAdminRouter } = require('../burials.admin.routes');

describe('burials/burials.admin.routes', () => {
	test('POST /api/burials: valida DECEASED_REQUIRED sin DB', async () => {
		const app = makeTestApp({ router: buildBurialsAdminRouter() });
		const res = await request(app)
			.post('/api/burials')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ graveId: 123 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'DECEASED_REQUIRED' });
		expect(db.withTransaction).not.toHaveBeenCalled();
	});
});
