export default /* sql */ `
-- Each person chooses how they get security notifications (both on by default).
ALTER TABLE users ADD COLUMN notify_push INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1;
-- A phone only receives notifications while it is signed in: signing out (or being signed out)
-- removes its subscription.
ALTER TABLE push_subscriptions ADD COLUMN session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE;
ALTER TABLE push_subscriptions ADD COLUMN user_agent TEXT;
`;
