const request = require('supertest');

jest.mock('../../../infrastructure/db', () => ({
	query: jest.fn(),
	withTransaction: jest.fn(),
}));

const db = require('../../../infrastructure/db');
const { makeTestApp } = require('../../../testUtils/makeTestApp');
const { buildSectorsAdminRouter } = require('../sectors.admin.routes');

describe('sectors/sectors.admin.routes', () => {
	test('POST /api/admin/sectors: valida NAME_REQUIRED sin DB', async () => {
		const app = makeTestApp({ router: buildSectorsAdminRouter() });
		const res = await request(app)
			.post('/api/admin/sectors')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ name: '' });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'NAME_REQUIRED' });
		expect(db.query).not.toHaveBeenCalled();
		expect(db.withTransaction).not.toHaveBeenCalled();
	});

	test('POST /api/admin/sectors/:sectorId/grid: valida SECTOR_ID_INVALID', async () => {
		const app = makeTestApp({ router: buildSectorsAdminRouter() });
		const res = await request(app)
			.post('/api/admin/sectors/nope/grid')
			.set('x-test-user', JSON.stringify({ id: 1, role: 'admin' }))
			.send({ rows: 1, cols: 1 });

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ ok: false, error: 'SECTOR_ID_INVALID' });
	});
});
