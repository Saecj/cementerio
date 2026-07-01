INSERT INTO grave_types (name)
VALUES ('premium')
ON CONFLICT (name) DO NOTHING;
