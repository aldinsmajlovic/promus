CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  username_norm TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  disabled_at   INTEGER
);

CREATE TABLE households (
  id         TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE household_members (
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id      TEXT NOT NULL REFERENCES users(id),
  role         TEXT NOT NULL,
  PRIMARY KEY (household_id, user_id)
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  kind         TEXT NOT NULL CHECK (kind IN ('browser','api')),
  name         TEXT,
  scopes       TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);

CREATE TABLE events (
  seq          INTEGER PRIMARY KEY,
  id           TEXT NOT NULL UNIQUE,
  household_id TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  type         TEXT NOT NULL,
  v            INTEGER NOT NULL,
  hlc          TEXT NOT NULL,
  occurred_at  INTEGER NOT NULL,
  received_at  INTEGER NOT NULL,
  undo_of      TEXT,
  payload      TEXT NOT NULL
);

CREATE INDEX events_household_seq ON events (household_id, seq);
