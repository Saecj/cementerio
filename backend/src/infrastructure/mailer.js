const nodemailer = require('nodemailer');
const dns = require('dns');

function createMailerFromEnv(env) {
	const host = env.SMTP_HOST;
	const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined;
	const user = env.SMTP_USER;
	const pass = env.SMTP_PASS;

	if (!host || !port || !user || !pass) return null;

	return nodemailer.createTransport({
		host,
		port,
		secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true',
		auth: {
			user,
			pass,
		},

		family: 4,

		connectionTimeout: 10000,
		greetingTimeout: 10000,
		socketTimeout: 10000,

		logger: true,
		debug: true,
	});
}

module.exports = {
	createMailerFromEnv,
};