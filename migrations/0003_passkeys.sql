-- Parent passkeys and single-use WebAuthn challenges.
-- Do not apply this to production or preview until Willis signs off.

CREATE TABLE parent_passkeys (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES parents(id),
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT,
  backed_up INTEGER NOT NULL DEFAULT 0,
  backup_eligible INTEGER NOT NULL DEFAULT 0,
  device_type TEXT,
  aaguid TEXT,
  friendly_name TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX parent_passkeys_parent ON parent_passkeys(parent_id);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'authentication')),
  parent_id TEXT REFERENCES parents(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX webauthn_challenges_expiry ON webauthn_challenges(expires_at);

-- Counts authenticate (per IP) and register (per parent) attempts.
CREATE TABLE webauthn_attempts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('authenticate', 'register')),
  subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX webauthn_attempts_lookup ON webauthn_attempts(scope, subject, created_at);
