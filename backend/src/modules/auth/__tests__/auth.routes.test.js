const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

jest.mock('../../../infrastructure/mailer', () => ({
	createMailerFromEnv: jest.fn(() => null),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildAuthRouter } = require('../auth.routes');

describe('auth/auth.routes', () => {
	test('POST /api/login: valida input (INVALID_INPUT) sin tocar DB', async () => {
		const app = makeTestApp({ router: buildAuthRouter() });
		const res = await request(app).post('/api/login').send({ email: 'nope', password: '' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'INVALID_INPUT' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('GET /api/me: user null si no hay sesión', async () => {
		const app = makeTestApp({ router: buildAuthRouter() });
		const res = await request(app).get('/api/me');
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, user: null });
	});

	test('POST /api/logout: responde ok', async () => {
		const app = makeTestApp({ router: buildAuthRouter() });
		const res = await request(app)
			.post('/api/logout')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true });
	});
});
