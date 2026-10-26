CREATE TABLE shares (
  id           TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  list_id      TEXT NOT NULL,
  token        TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  from_seq     INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER
);
CREATE INDEX shares_household ON shares (household_id);

CREATE TABLE guests (
  id         TEXT PRIMARY KEY,
  share_id   TEXT NOT NULL REFERENCES shares(id),
  name       TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX guests_share ON guests (share_id);
