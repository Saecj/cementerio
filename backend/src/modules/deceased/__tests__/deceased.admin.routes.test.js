const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildDeceasedAdminRouter } = require('../deceased.admin.routes');

describe('deceased/deceased.admin.routes', () => {
	test('GET /api/deceased: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildDeceasedAdminRouter() });
		const res = await request(app).get('/api/deceased');

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('POST /api/deceased: valida NAME_REQUIRED sin DB', async () => {
		const app = makeTestApp({ router: buildDeceasedAdminRouter() });
		const res = await request(app)
			.post('/api/deceased')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ firstName: '', lastName: '' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'NAME_REQUIRED' });
		expect(db.query).not.toHaveBeenCalled();
	});
});
