const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildReservationsClientRouter } = require('../reservations.client.routes');

describe('reservations/reservations.client.routes', () => {
	test('GET /api/client/reservations: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app).get('/api/client/reservations');

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('GET /api/client/cemetery-map: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app).get('/api/client/cemetery-map');

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('GET /api/client/cemetery-map: devuelve sectores y difuntos del cliente', async () => {
		db.query
			.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 })
			.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
			.mockResolvedValueOnce({
			rows: [
				{
					id: 1,
					reservation_code: 'RSV-1',
					grave_id: 5,
					grave_code: 'A-01',
					grave_status: 'available',
					sector_id: 2,
					sector_name: 'Sector A',
					branch_id: 3,
					branch_name: 'Central',
					row_number: 1,
					col_number: 1,
					deceased_full_name: 'Juan Perez',
				},
			],
			rowCount: 1,
		});

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.get('/api/client/cemetery-map')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.sectors).toEqual([
			{ id: 2, name: 'Sector A', branch_id: 3, branch_name: 'Central', count: 1 },
		]);
		expect(res.body.graves[0].grave_code).toBe('A-01');
	});

	test('POST /api/client/reservations: 403 si no hay client profile', async () => {
		db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.post('/api/client/reservations')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }))
			.send({ graveId: 1 });

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'CLIENT_REQUIRED' });
		expect(db.query).toHaveBeenCalledTimes(1);
	});

	test('POST /api/client/reservations/:id/cancel: 401 si no hay sesión', async () => {
		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app).post('/api/client/reservations/1/cancel');

		expect(res.status).toBe(401);
		expect(res.body).toEqual({ ok: false, error: 'UNAUTHORIZED' });
	});

	test('POST /api/client/reservations/:id/cancel: 403 si no hay client profile', async () => {
		db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.post('/api/client/reservations/1/cancel')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(403);
		expect(res.body).toEqual({ ok: false, error: 'CLIENT_REQUIRED' });
		expect(db.query).toHaveBeenCalledTimes(1);
	});

	test('POST /api/client/reservations/:id/cancel: 404 si no existe o no es del cliente', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 });
		db.withTransaction.mockImplementationOnce(async (fn) => {
			const client = {
				query: jest.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }),
			};
			return fn(client);
		});

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.post('/api/client/reservations/999/cancel')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ ok: false, error: 'RESERVATION_NOT_FOUND' });
	});

	test('POST /api/client/reservations/:id/cancel: 409 si no está pending', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 });
		db.withTransaction.mockImplementationOnce(async (fn) => {
			const client = {
				query: jest.fn().mockResolvedValueOnce({ rows: [{ id: 1, status: 'confirmed' }], rowCount: 1 }),
			};
			return fn(client);
		});

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.post('/api/client/reservations/1/cancel')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(409);
		expect(res.body).toEqual({ ok: false, error: 'RESERVATION_NOT_PENDING' });
	});

	test('POST /api/client/reservations/:id/cancel: 200 cancela una reserva pending', async () => {
		db.query.mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 });
		db.withTransaction.mockImplementationOnce(async (fn) => {
			const client = {
				query: jest
					.fn()
					.mockResolvedValueOnce({ rows: [{ id: 1, status: 'pending' }], rowCount: 1 })
					.mockResolvedValueOnce({
						rows: [
							{
								id: 1,
								reservation_code: 'RSV-001',
								client_id: 10,
								grave_id: 2,
								reserved_from: null,
								reserved_to: null,
								status: 'cancelled',
								created_at: new Date().toISOString(),
							},
						],
						rowCount: 1,
					}),
			};
			return fn(client);
		});

		const app = makeTestApp({ router: buildReservationsClientRouter() });
		const res = await request(app)
			.post('/api/client/reservations/1/cancel')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);
		expect(res.body.reservation.status).toBe('cancelled');
	});
});
