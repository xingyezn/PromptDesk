CREATE TABLE service_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

INSERT INTO service_meta (key, value) VALUES ('schema_version', '1');
