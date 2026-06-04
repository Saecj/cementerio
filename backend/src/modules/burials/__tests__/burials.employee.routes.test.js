const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildBurialsEmployeeRouter } = require('../burials.employee.routes');

describe('burials/burials.employee.routes', () => {
	test('POST /api/employee/burials: valida NAME_REQUIRED sin DB', async () => {
		const app = makeTestApp({ router: buildBurialsEmployeeRouter() });
		const res = await request(app)
			.post('/api/employee/burials')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ firstName: '', lastName: '', graveId: 1 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'NAME_REQUIRED' });
		expect(db.withTransaction).not.toHaveBeenCalled();
	});
});
