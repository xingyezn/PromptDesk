CREATE TABLE cloud_share (
  id TEXT PRIMARY KEY NOT NULL,
  ownerId TEXT NOT NULL,
  projectId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  revokedAt TEXT,
  UNIQUE(projectId),
  FOREIGN KEY(projectId,ownerId) REFERENCES cloud_project(id,ownerId) ON DELETE CASCADE
);
CREATE INDEX cloud_share_token ON cloud_share(token);
UPDATE service_meta SET value='5' WHERE key='schema_version';