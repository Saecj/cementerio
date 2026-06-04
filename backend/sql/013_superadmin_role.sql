-- Add superadmin role

INSERT INTO roles (name) VALUES ('superadmin')
	ON CONFLICT (name) DO NOTHING;
