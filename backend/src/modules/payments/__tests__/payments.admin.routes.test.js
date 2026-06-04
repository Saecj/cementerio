const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildPaymentsAdminRouter } = require('../payments.admin.routes');

describe('payments/payments.admin.routes', () => {
	test('GET /api/payments/:id/receipt.pdf: valida ID_INVALID sin DB', async () => {
		const app = makeTestApp({ router: buildPaymentsAdminRouter() });
		const res = await request(app)
			.get('/api/payments/nope/receipt.pdf')
			.set('x-test-user', JSON.stringify({ id: 2, role: 'employee', permissions: ['payments'] }));

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'ID_INVALID' });
		expect(db.query).not.toHaveBeenCalled();
	});
});
