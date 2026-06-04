-- Employee job title (cargo)

ALTER TABLE employees
	ADD COLUMN IF NOT EXISTS job_title TEXT;
