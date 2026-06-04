const crypto = require('node:crypto');

const db = require('../infrastructure/db');
const { normalizeEmail, hashPassword, validatePasswordStrength } = require('../modules/auth/auth.service');

function generateStrongPassword() {
	// Garantiza: >=8, mayúscula, número, símbolo.
	return `A${crypto.randomBytes(8).toString('hex')}!9`;
}

async function ensureBootstrapAdmin() {
	const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL);
	if (!email) return;

	let password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '').trim();
	const passwordProvided = Boolean(password);
	if (!passwordProvided) {
		password = generateStrongPassword();
	}

	const strength = validatePasswordStrength(password);
	if (!strength.ok) {
		console.warn(
			`[bootstrap] BOOTSTRAP_ADMIN_PASSWORD no cumple política (${strength.reason}). No se creó/actualizó el admin.`,
		);
		return;
	}

	try {
		await db.withTransaction(async (client) => {
			const roles = await client.query("SELECT id, name FROM roles WHERE name IN ('superadmin','admin')");
			const superadminRoleId = roles.rows.find((r) => r.name === 'superadmin')?.id;
			const adminRoleId = roles.rows.find((r) => r.name === 'admin')?.id;
			const bootstrapRoleId = superadminRoleId || adminRoleId;
			const bootstrapRoleName = superadminRoleId ? 'superadmin' : 'admin';
			if (!bootstrapRoleId) {
				console.warn('[bootstrap] Roles no existen (migra la BD).');
				return;
			}

			const existing = await client.query(
				`SELECT id, role_id, password_hash, email_verified_at
				 FROM users
				 WHERE email = $1
				 FOR UPDATE`,
				[email],
			);

			const passwordHash = await hashPassword(password);

			if (existing.rowCount === 0) {
				const inserted = await client.query(
					`INSERT INTO users (email, role_id, password_hash, email_verified_at)
					 VALUES ($1, $2, $3, now())
					 RETURNING id`,
					[email, bootstrapRoleId, passwordHash],
				);
				const userId = inserted.rows[0]?.id;
				if (!userId) throw new Error('BOOTSTRAP_ADMIN_CREATE_FAILED');

				if (!passwordProvided) {
					console.warn(`[bootstrap] ${bootstrapRoleName} creado: ${email}`);
					console.warn(`[bootstrap] Password generado (guárdalo): ${password}`);
				} else {
					console.warn(`[bootstrap] ${bootstrapRoleName} creado: ${email}`);
				}
				return;
			}

			const u = existing.rows[0];
			// Inmutabilidad: NO pisamos password existente (ni aunque sea null).
			const shouldPromoteRole = u.role_id !== bootstrapRoleId;
			const shouldVerify = !u.email_verified_at;

			if (!shouldPromoteRole && !shouldVerify) return;

			await client.query(
				`UPDATE users
				 SET role_id = $1,
				 	email_verified_at = CASE WHEN email_verified_at IS NULL THEN now() ELSE email_verified_at END
				 WHERE id = $2`,
				[bootstrapRoleId, u.id],
			);

			console.warn(`[bootstrap] ${bootstrapRoleName} actualizado: ${email}`);
		});
	} catch (err) {
		console.warn('[bootstrap] Falló ensureBootstrapAdmin:', err?.message || err);
	}
}

module.exports = {
	ensureBootstrapAdmin,
};
