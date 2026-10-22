CREATE TABLE invites (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  used_at      INTEGER,
  used_by      TEXT REFERENCES users(id),
  revoked_at   INTEGER
);
