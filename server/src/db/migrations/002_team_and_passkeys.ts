export default /* sql */ `
-- Team accounts: any number of users. Owners can add/remove team members.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';   -- owner | member
ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
-- Everyone who existed before team roles were introduced is an owner.
UPDATE users SET role = 'owner';

-- Biometric login (WebAuthn passkeys: Face ID, Touch ID, fingerprint, face unlock).
CREATE TABLE passkeys (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,   -- base64url
  public_key    BLOB NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT NOT NULL DEFAULT '',
  label         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  TEXT
);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);

-- One-time WebAuthn challenges (short-lived).
CREATE TABLE auth_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  user_id    INTEGER,
  purpose    TEXT NOT NULL,             -- register | login
  expires_at TEXT NOT NULL
);
`;
