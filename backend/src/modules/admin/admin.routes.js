const express = require('express');
const db = require('../../infrastructure/db');
const { requireRole, requirePermission, requireSuperadmin } = require('../../middleware/auth');
const { validatePasswordStrength, hashPassword } = require('../auth/auth.service');
const { buildReservationsAdminRouter } = require('../reservations/reservations.admin.routes');
const { buildPaymentsAdminRouter } = require('../payments/payments.admin.routes');
const { buildDeceasedAdminRouter } = require('../deceased/deceased.admin.routes');
const { buildBurialsAdminRouter } = require('../burials/burials.admin.routes');
const { buildSettingsAdminRouter } = require('../settings/settings.admin.routes');
const { buildAnalyticsAdminRouter } = require('../analytics/analytics.admin.routes');

const EMPLOYEE_PERMISSION_KEYS = ['graves', 'deceased', 'reservations', 'payments', 'employees', 'reports'];

function normalizePermissions(perms) {
	if (!Array.isArray(perms)) return [];
	const cleaned = perms
		.map((p) => String(p || '').trim())
		.filter((p) => EMPLOYEE_PERMISSION_KEYS.includes(p));
	return Array.from(new Set(cleaned));
}

function normalizeNullablePermissions(perms) {
	if (perms == null) return null;
	return normalizePermissions(perms);
}

function normalizeEmail(email) {
	return String(email || '').trim().toLowerCase();
}

function isBootstrapSuperadminEmail(email) {
	const bootstrap = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
	if (!bootstrap) return false;
	return normalizeEmail(email) === bootstrap;
}

function normalizeQuery(value) {
	return String(value || '').trim();
}

function isValidPasswordHash(value) {
	return typeof value === 'string' && value.startsWith('scrypt:');
}

function requireFullAdminAccess(req, res, next) {
	if (!req.session?.user) return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
	const user = req.session.user;
	if (user.role === 'superadmin') return next();
	// Admin sin restricciones: permissions == null => acceso total
	if (user.role === 'admin' && user.permissions == null) return next();
	return res.status(403).json({ ok: false, error: 'FORBIDDEN' });
}

function buildAdminRouter() {
	const router = express.Router();

	// Solo superadmin: listar admins y administrar sus permisos.
	router.get('/admins', requireSuperadmin, async (req, res) => {
		const result = await db.query(
			`
				SELECT
					u.id,
					u.email,
					u.username,
					u.admin_permissions,
					(u.password_hash LIKE 'scrypt:%') AS has_password
				FROM users u
				JOIN roles r ON r.id = u.role_id
				WHERE r.name = 'admin'
				ORDER BY u.id DESC
				LIMIT 200
			`,
		);
		return res.status(200).json({ ok: true, admins: result.rows });
	});

	// Solo superadmin: setea permisos de un admin. NULL => acceso total.
	router.put('/admins/:id/permissions', requireSuperadmin, async (req, res) => {
		const id = Number(req.params?.id);
		if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: 'ID_INVALID' });

		const target = await db.query(
			`
				SELECT u.id, u.email, r.name AS role
				FROM users u
				JOIN roles r ON r.id = u.role_id
				WHERE u.id = $1
				LIMIT 1
			`,
			[id],
		);
		const row = target.rows[0];
		if (!row) return res.status(404).json({ ok: false, error: 'NOT_FOUND' });
		if (row.role !== 'admin') return res.status(400).json({ ok: false, error: 'ROLE_INVALID' });
		if (isBootstrapSuperadminEmail(row.email)) {
			return res.status(403).json({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
		}

		const permissions = normalizeNullablePermissions(req.body?.permissions);
		const updated = await db.query(
			`UPDATE users
			 SET admin_permissions = $1
			 WHERE id = $2
			 RETURNING id, email, admin_permissions`,
			[permissions, id],
		);
		return res.status(200).json({ ok: true, admin: updated.rows[0] });
	});

	// Asignar rol a un usuario (MVP) para poder crear empleados sin panel complejo.
	router.post('/users/role', requireRole('admin'), requireFullAdminAccess, async (req, res) => {
		const email = normalizeEmail(req.body?.email);
		const role = normalizeQuery(req.body?.role);
		const password = String(req.body?.password || '');
		const confirmPassword = String(req.body?.confirmPassword || '');
		if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'EMAIL_INVALID' });
		if (isBootstrapSuperadminEmail(email)) {
			return res.status(403).json({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
		}
		if (!['admin', 'employee', 'visitor', 'client'].includes(role)) {
			return res.status(400).json({ ok: false, error: 'ROLE_INVALID' });
		}

		const wantsPasswordUpdate = Boolean(password || confirmPassword);
		if (wantsPasswordUpdate) {
			if (!password || password !== confirmPassword) {
				return res.status(400).json({ ok: false, error: 'PASSWORD_MISMATCH' });
			}
			const strength = validatePasswordStrength(password);
			if (!strength.ok) {
				return res.status(400).json({ ok: false, error: strength.reason || 'PASSWORD_WEAK' });
			}
		}

		const passwordHash = wantsPasswordUpdate ? await hashPassword(password) : null;
		const defaultUsername = email.includes('@') ? email.split('@')[0].slice(0, 24) : null;
		const isStaffRole = role === 'admin' || role === 'employee';

		const roleResult = await db.query('SELECT id FROM roles WHERE name = $1', [role]);
		const roleId = roleResult.rows[0]?.id;
		if (!roleId) return res.status(500).json({ ok: false, error: 'ROLES_NOT_INITIALIZED' });

		const existingUser = await db.query('SELECT id, password_hash FROM users WHERE email = $1 LIMIT 1', [email]);
		const hasExistingUser = existingUser.rowCount > 0;
		const existingPasswordHash = existingUser.rows[0]?.password_hash || null;
		const hasValidPassword = isValidPasswordHash(existingPasswordHash);
		if (isStaffRole && (!hasExistingUser || !hasValidPassword) && !passwordHash) {
			return res.status(400).json({ ok: false, error: 'PASSWORD_REQUIRED' });
		}

		const userResult = await db.query(
			`INSERT INTO users (email, role_id)
			 VALUES ($1, $2)
			 ON CONFLICT (email) DO UPDATE SET role_id = EXCLUDED.role_id
			 RETURNING id, email, role_id`,
			[email, roleId],
		);

		// Para staff (o si se está seteando password), asegura username y correo verificado.
		if (isStaffRole || passwordHash) {
			await db.query(
				`UPDATE users
				 SET username = COALESCE(username, $1),
				 	email_verified_at = COALESCE(email_verified_at, now())
				 WHERE id = $2`,
				[defaultUsername, userResult.rows[0].id],
			);
		}
		if (passwordHash) {
			await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userResult.rows[0].id]);
		}

		return res.status(200).json({ ok: true, user: userResult.rows[0] });
	});

	// Crear/actualizar perfil empleado asociado a un user (1:1) + rol employee
	// Admin restringido requiere permiso 'employees'.
	router.post('/employees', requireRole('admin'), requirePermission('employees'), async (req, res) => {
		const email = normalizeEmail(req.body?.email);
		const fullName = normalizeQuery(req.body?.fullName) || null;
		const phone = normalizeQuery(req.body?.phone) || null;
		const jobTitle = normalizeQuery(req.body?.jobTitle ?? req.body?.cargo) || null;
		const permissions = normalizePermissions(req.body?.permissions);
		const password = String(req.body?.password || '');
		const confirmPassword = String(req.body?.confirmPassword || '');
		if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'EMAIL_INVALID' });
		if (isBootstrapSuperadminEmail(email)) {
			return res.status(403).json({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
		}

		const wantsPasswordUpdate = Boolean(password || confirmPassword);
		if (wantsPasswordUpdate) {
			if (!password || password !== confirmPassword) {
				return res.status(400).json({ ok: false, error: 'PASSWORD_MISMATCH' });
			}
			const strength = validatePasswordStrength(password);
			if (!strength.ok) {
				return res.status(400).json({ ok: false, error: strength.reason || 'PASSWORD_WEAK' });
			}
		}

		const passwordHash = wantsPasswordUpdate ? await hashPassword(password) : null;
		const defaultUsername = email.includes('@') ? email.split('@')[0].slice(0, 24) : null;

		const employeeRole = await db.query("SELECT id FROM roles WHERE name = 'employee' LIMIT 1");
		const employeeRoleId = employeeRole.rows[0]?.id;
		if (!employeeRoleId) return res.status(500).json({ ok: false, error: 'ROLES_NOT_INITIALIZED' });

		let created;
		try {
			created = await db.withTransaction(async (client) => {
				const existingUser = await client.query(
					'SELECT id, password_hash, email_verified_at, username FROM users WHERE email = $1 LIMIT 1',
					[email],
				);
				const hasExistingUser = existingUser.rowCount > 0;
				const existingPasswordHash = existingUser.rows[0]?.password_hash || null;
				const hasValidPassword = isValidPasswordHash(existingPasswordHash);
				if (!hasExistingUser && !passwordHash) {
					const err = new Error('PASSWORD_REQUIRED');
					err.code = 'PASSWORD_REQUIRED';
					throw err;
				}
				if (hasExistingUser && !hasValidPassword && !passwordHash) {
					const err = new Error('PASSWORD_REQUIRED');
					err.code = 'PASSWORD_REQUIRED';
					throw err;
				}

				const userResult = await client.query(
					`INSERT INTO users (email, role_id)
					 VALUES ($1, $2)
					 ON CONFLICT (email) DO UPDATE SET role_id = EXCLUDED.role_id
					 RETURNING id, email`,
					[email, employeeRoleId],
				);
				const user = userResult.rows[0];

				// Asegura username por defecto y correo verificado para poder login con password.
				await client.query(
					`UPDATE users
					 SET username = COALESCE(username, $1),
					 	email_verified_at = COALESCE(email_verified_at, now())
					 WHERE id = $2`,
					[defaultUsername, user.id],
				);

				if (passwordHash) {
					await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, user.id]);
				}

				const employeeResult = await client.query(
					`INSERT INTO employees (user_id, full_name, phone, permissions, job_title)
					 VALUES ($1, $2, $3, $4, $5)
					 ON CONFLICT (user_id) DO UPDATE
					 SET full_name = EXCLUDED.full_name,
					 	phone = EXCLUDED.phone,
					 	permissions = EXCLUDED.permissions,
					 	job_title = EXCLUDED.job_title
					 RETURNING id, user_id, full_name, phone, permissions, job_title`,
					[user.id, fullName, phone, permissions, jobTitle],
				);

				return { user, employee: employeeResult.rows[0] };
			});
		} catch (e) {
			const code = e?.code || e?.message;
			if (code === 'PASSWORD_REQUIRED') return res.status(400).json({ ok: false, error: 'PASSWORD_REQUIRED' });
			throw e;
		}

		// Nota: si el admin quiere que el empleado inicie sesión con password, ya quedó verificado.
		return res.status(200).json({ ok: true, ...created });
	});

	// Crear perfil cliente/visitante asociado a un user (1:1)
	router.post('/clients', requireRole('admin'), requireFullAdminAccess, async (req, res) => {
		const email = normalizeEmail(req.body?.email);
		const fullName = normalizeQuery(req.body?.fullName) || null;
		const phone = normalizeQuery(req.body?.phone) || null;
		const documentId = normalizeQuery(req.body?.documentId) || null;
		if (!email || !email.includes('@')) return res.status(400).json({ ok: false, error: 'EMAIL_INVALID' });
		if (isBootstrapSuperadminEmail(email)) {
			return res.status(403).json({ ok: false, error: 'IMMUTABLE_SUPERADMIN' });
		}

		const clientRole = await db.query("SELECT id FROM roles WHERE name = 'client' LIMIT 1");
		const clientRoleId = clientRole.rows[0]?.id;
		if (!clientRoleId) return res.status(500).json({ ok: false, error: 'ROLES_NOT_INITIALIZED' });

		const created = await db.withTransaction(async (client) => {
			const userResult = await client.query(
				`INSERT INTO users (email, role_id)
				 VALUES ($1, $2)
				 ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email, role_id = EXCLUDED.role_id
				 RETURNING id, email`,
				[email, clientRoleId],
			);
			const user = userResult.rows[0];

			const clientResult = await client.query(
				`INSERT INTO clients (user_id, full_name, phone, document_id)
				 VALUES ($1, $2, $3, $4)
				 ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, phone = EXCLUDED.phone, document_id = EXCLUDED.document_id
				 RETURNING id, user_id, full_name, phone, document_id`,
				[user.id, fullName, phone, documentId],
			);

			return { user, client: clientResult.rows[0] };
		});

		return res.status(200).json({ ok: true, ...created });
	});

	// Listar empleados (admins restringidos requieren permiso 'employees')
	router.get('/employees', requireRole('admin'), requirePermission('employees'), async (req, res) => {
		const result = await db.query(
			`
				SELECT
					e.id,
					e.user_id,
					e.full_name,
					e.phone,
					e.job_title,
					e.permissions,
					u.email,
					(u.password_hash LIKE 'scrypt:%') AS has_password
				FROM employees e
				JOIN users u ON u.id = e.user_id
				ORDER BY e.id DESC
				LIMIT 200
			`,
		);
		return res.status(200).json({ ok: true, employees: result.rows });
	});

	// Dominio: deceased + burials (admin/employee)
	// Mantiene los mismos endpoints bajo /api/admin/deceased y /api/admin/burials
	router.use(buildDeceasedAdminRouter());
	router.use(buildBurialsAdminRouter());

	// Dominio: payments + reservations (admin/employee)
	// Mantiene los mismos endpoints bajo /api/admin/*
	router.use(buildPaymentsAdminRouter());
	router.use(buildReservationsAdminRouter());

	// Dominio: analytics (admin/employee)
	router.use(buildAnalyticsAdminRouter());

	// Dominio: settings (admin/employee)
	// Mantiene endpoints bajo /api/admin/*
	router.use(buildSettingsAdminRouter());

	return router;
}

module.exports = {
	buildAdminRouter,
};
