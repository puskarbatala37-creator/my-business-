export default /* sql */ `
-- Self sign-up: an account that is waiting for an owner's approval can't sign in yet.
ALTER TABLE users ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;
`;
