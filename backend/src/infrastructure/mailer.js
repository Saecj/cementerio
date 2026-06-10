const nodemailer = require('nodemailer');

function createMailerFromEnv(env) {
	const host = env.SMTP_HOST;
	const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined;
	const user = env.SMTP_USER;
	const pass = env.SMTP_PASS;

	if (!host || !port || !user || !pass) {
		console.warn('[SMTP] Configuración incompleta');
		return null;
	}

	console.log('[SMTP] Configuración:', {
		host,
		port,
		secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
		user,
	});

	return nodemailer.createTransport({
		host,
		port,
		secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
		auth: {
			user,
			pass,
		},

		// Fuerza IPv4
		family: 4,

		// Timeouts
		connectionTimeout: 10000,
		greetingTimeout: 10000,
		socketTimeout: 10000,

		// Logs SMTP
		logger: true,
		debug: true,
	});
}

module.exports = {
	createMailerFromEnv,
};