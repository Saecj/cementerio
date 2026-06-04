const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildAdminRouter } = require('../admin.routes');
const db = require('../../../infrastructure/db');

describe('admin/admin.routes', () => {
	beforeEach(() => {
		db.query.mockReset();
		db.withTransaction?.mockReset?.();
	});

	afterEach(() => {
		delete process.env.BOOTSTRAP_ADMIN_EMAIL;
	});

	test('POST /api/users/role: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app).post('/api/users/role').send({ email: 'a@b.com', role: 'admin' });

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('POST /api/users/role: 403 si no es admin', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/users/role')
			.set('x-test-user', JSON.stringify({ id: 2, role: 'employee', permissions: ['reports'] }))
			.send({ email: 'a@b.com', role: 'admin' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
	});

	test('POST /api/users/role: 403 si admin está restringido', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/users/role')
			.set('x-test-user', JSON.stringify({ id: 2, role: 'admin', permissions: [] }))
			.send({ email: 'a@b.com', role: 'visitor' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('POST /api/users/role: superadmin pasa requireRole(admin)', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		db.query
			.mockResolvedValueOnce({ rows: [{ id: 99 }] })
			.mockResolvedValueOnce({ rowCount: 0, rows: [] })
			.mockResolvedValueOnce({ rows: [{ id: 10, email: 'a@b.com', role_id: 99 }] });

		const res = await request(app)
			.post('/api/users/role')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'superadmin', permissions: [] }))
			.send({ email: 'a@b.com', role: 'visitor' });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, user: { id: 10, email: 'a@b.com', role_id: 99 } });
	});

	test('POST /api/users/role: 403 si intenta modificar bootstrap superadmin', async () => {
		process.env.BOOTSTRAP_ADMIN_EMAIL = 'root@x.com';
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/users/role')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ email: 'root@x.com', role: 'employee' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('POST /api/employees: 403 si intenta usar email del bootstrap superadmin', async () => {
		process.env.BOOTSTRAP_ADMIN_EMAIL = 'root@x.com';
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/employees')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ email: 'root@x.com', fullName: 'X' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
	});

	test('POST /api/employees: 403 si admin está restringido', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/employees')
			.set('x-test-user', JSON.stringify({ id: 2, role: 'admin', permissions: [] }))
			.send({ email: 'emp@x.com', fullName: 'X' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('POST /api/clients: 403 si intenta usar email del bootstrap superadmin', async () => {
		process.env.BOOTSTRAP_ADMIN_EMAIL = 'root@x.com';
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.post('/api/clients')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ email: 'root@x.com', fullName: 'X' });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
	});

	test('GET /api/admins: 403 si no es superadmin', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		const res = await request(app)
			.get('/api/admins')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }));

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'FORBIDDEN' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('GET /api/admins: 200 si es superadmin', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		db.query.mockResolvedValueOnce({ rows: [{ id: 9, email: 'admin@x.com', admin_permissions: null, has_password: true }] });

		const res = await request(app)
			.get('/api/admins')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'superadmin' }));

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(Array.isArray(res.body.admins)).toBe(true);
	});

	test('GET /api/employees: 200 si admin restringido tiene permiso employees', async () => {
		const app = makeTestApp({ router: buildAdminRouter() });
		db.query.mockResolvedValueOnce({ rows: [] });

		const res = await request(app)
			.get('/api/employees')
			.set('x-test-user', JSON.stringify({ id: 2, role: 'admin', permissions: ['employees'] }));

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, employees: [] });
	});
});
