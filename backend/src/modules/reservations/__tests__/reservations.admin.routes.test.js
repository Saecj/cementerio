const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildReservationsAdminRouter } = require('../reservations.admin.routes');

describe('reservations/reservations.admin.routes', () => {
	test('POST /api/reservations: valida EMAIL_INVALID sin DB', async () => {
		const app = makeTestApp({ router: buildReservationsAdminRouter() });
		const res = await request(app)
			.post('/api/reservations')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ clientEmail: 'nope', graveId: 1, status: 'pending' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'EMAIL_INVALID' });
		expect(db.query).not.toHaveBeenCalled();
	});

	test('PATCH /api/reservations/:id: valida ID_INVALID', async () => {
		const app = makeTestApp({ router: buildReservationsAdminRouter() });
		const res = await request(app)
			.patch('/api/reservations/nope')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ status: 'confirmed' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'ID_INVALID' });
	});
});
