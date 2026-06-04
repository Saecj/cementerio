const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildPaymentsClientRouter } = require('../payments.client.routes');

describe('payments/payments.client.routes', () => {
	test('GET /api/client/payments/:id/receipt.pdf: valida ID_INVALID sin DB', async () => {
		const app = makeTestApp({ router: buildPaymentsClientRouter() });
		const res = await request(app)
			.get('/api/client/payments/nope/receipt.pdf')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'client' }));

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'ID_INVALID' });
		expect(db.query).not.toHaveBeenCalled();
	});
});
