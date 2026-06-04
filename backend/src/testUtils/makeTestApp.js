const express = require('express');

function makeTestApp({ router, mountPath = '/api' } = {}) {
	if (!router) throw new Error('router is required');

	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.session = req.session || {};
		// Permite inyectar usuario de sesión desde tests sin depender de express-session
		const rawUser = req.get('x-test-user');
		if (rawUser) req.session.user = JSON.parse(rawUser);
		// Soporta /api/auth/logout
		if (typeof req.session.destroy !== 'function') {
			req.session.destroy = (cb) => cb && cb();
		}
		next();
	});

	app.use(mountPath, router);

	// Handler de errores para que Jest falle con payload estable
	app.use((err, _req, res, _next) => {
		return res.status(500).json({ ok: false, error: 'TEST_ERROR', message: String(err?.message || err) });
	});

	return app;
}

module.exports = {
	makeTestApp,
};
