ALTER TABLE cloud_project ADD COLUMN sortOrder REAL NOT NULL DEFAULT 0;
ALTER TABLE cloud_project ADD COLUMN color TEXT NOT NULL DEFAULT 'green' CHECK(color IN ('slate','green','teal','blue','indigo','violet','pink','amber','red'));
CREATE TABLE cloud_space (
  ownerId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  operation TEXT NOT NULL DEFAULT '',
  updatedAt TEXT NOT NULL
);
INSERT INTO cloud_space(ownerId,revision,updatedAt) SELECT id,1,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM user;
CREATE INDEX cloud_project_owner_order ON cloud_project(ownerId,sortOrder);
UPDATE service_meta SET value='4' WHERE key='schema_version';