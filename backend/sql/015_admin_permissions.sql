-- Permisos por admin (sub-admins con acceso limitado por módulo)
-- NULL = acceso total (comportamiento actual)
-- [] o lista = acceso restringido a los permisos indicados

ALTER TABLE users
	ADD COLUMN IF NOT EXISTS admin_permissions TEXT[];
