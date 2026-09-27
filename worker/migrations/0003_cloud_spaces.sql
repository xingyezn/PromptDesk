CREATE TABLE user_access (
  userId TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
  disabled INTEGER NOT NULL DEFAULT 0 CHECK(disabled IN (0,1)),
  mustChangePassword INTEGER NOT NULL DEFAULT 0 CHECK(mustChangePassword IN (0,1))
);
INSERT INTO user_access(userId) SELECT id FROM user;
CREATE TRIGGER user_access_create AFTER INSERT ON user BEGIN
  INSERT INTO user_access(userId) VALUES (NEW.id);
END;
CREATE TABLE cloud_project (
  id TEXT PRIMARY KEY NOT NULL,
  ownerId TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1, operation TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)), deletedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  UNIQUE(id,ownerId)
);
CREATE INDEX cloud_project_owner ON cloud_project(ownerId,createdAt);
CREATE TABLE cloud_prompt (
  id TEXT PRIMARY KEY NOT NULL, projectId TEXT NOT NULL, ownerId TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '未命名提示词', body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','ready','completed')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  sortOrder REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1,
  nextVersion INTEGER NOT NULL DEFAULT 1, operation TEXT NOT NULL DEFAULT '', deletedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
  FOREIGN KEY(projectId,ownerId) REFERENCES cloud_project(id,ownerId) ON DELETE CASCADE,
  UNIQUE(id,ownerId)
);
CREATE INDEX cloud_prompt_owner_project ON cloud_prompt(ownerId,projectId,sortOrder);
CREATE TABLE cloud_version (
  id TEXT PRIMARY KEY NOT NULL, promptId TEXT NOT NULL, ownerId TEXT NOT NULL,
  number INTEGER NOT NULL, body TEXT NOT NULL, createdAt TEXT NOT NULL,
  FOREIGN KEY(promptId,ownerId) REFERENCES cloud_prompt(id,ownerId) ON DELETE CASCADE,
  UNIQUE(promptId,number)
);
CREATE INDEX cloud_version_owner_prompt ON cloud_version(ownerId,promptId,number);
CREATE TABLE cloud_usage (
  userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL DEFAULT 0 CHECK(bytes >= 0 AND bytes <= 10485760)
);
INSERT INTO cloud_usage(userId) SELECT id FROM user;
CREATE TRIGGER cloud_usage_create AFTER INSERT ON user BEGIN
  INSERT INTO cloud_usage(userId) VALUES(NEW.id);
END;
CREATE TRIGGER cloud_prompt_usage_insert AFTER INSERT ON cloud_prompt BEGIN
  UPDATE cloud_usage SET bytes=bytes+length(CAST(NEW.body AS BLOB)) WHERE userId=NEW.ownerId;
END;
CREATE TRIGGER cloud_prompt_usage_update AFTER UPDATE OF body ON cloud_prompt BEGIN
  UPDATE cloud_usage SET bytes=bytes+length(CAST(NEW.body AS BLOB))-length(CAST(OLD.body AS BLOB)) WHERE userId=NEW.ownerId;
END;
CREATE TRIGGER cloud_prompt_usage_delete AFTER DELETE ON cloud_prompt BEGIN
  UPDATE cloud_usage SET bytes=bytes-length(CAST(OLD.body AS BLOB)) WHERE userId=OLD.ownerId;
END;
CREATE TRIGGER cloud_version_usage_insert AFTER INSERT ON cloud_version BEGIN
  UPDATE cloud_usage SET bytes=bytes+length(CAST(NEW.body AS BLOB)) WHERE userId=NEW.ownerId;
END;
CREATE TRIGGER cloud_version_usage_delete AFTER DELETE ON cloud_version BEGIN
  UPDATE cloud_usage SET bytes=bytes-length(CAST(OLD.body AS BLOB)) WHERE userId=OLD.ownerId;
END;
CREATE TRIGGER cloud_version_immutable BEFORE UPDATE ON cloud_version BEGIN
  SELECT RAISE(ABORT,'IMMUTABLE_VERSION');
END;
UPDATE service_meta SET value='3' WHERE key='schema_version';
