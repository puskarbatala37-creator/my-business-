export default /* sql */ `
-- Sign in with an email address; a mobile number for account recovery codes.
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN phone TEXT;
ALTER TABLE users ADD COLUMN phone_verified_at TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;
-- Accounts whose username already is an email address keep it as their login.
UPDATE users SET email = lower(username) WHERE username LIKE '%_@_%._%';

-- One-time codes sent by SMS (account recovery, confirming a phone number). Only a hash is stored.
CREATE TABLE one_time_codes (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    TEXT NOT NULL,          -- recover | verify_phone
  code_hash  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_one_time_codes_user ON one_time_codes(user_id, purpose);
`;
