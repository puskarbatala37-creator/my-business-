export default /* sql */ `
-- Supplier bill types the team added themselves (on top of Fabric, Stitching, Ready-made, Thread).
CREATE TABLE receipt_types (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Bills already typed with a preset (any capitalisation) use its usual spelling.
UPDATE receipts SET category = 'Fabric' WHERE lower(trim(category)) = 'fabric';
UPDATE receipts SET category = 'Stitching' WHERE lower(trim(category)) = 'stitching';
UPDATE receipts SET category = 'Ready-made' WHERE lower(trim(category)) IN ('ready-made', 'ready made', 'readymade');
UPDATE receipts SET category = 'Thread' WHERE lower(trim(category)) = 'thread';
-- Other types already typed on saved bills become choices too.
INSERT OR IGNORE INTO receipt_types (name)
  SELECT DISTINCT trim(category) FROM receipts
   WHERE trim(category) <> ''
     AND category NOT IN ('Fabric', 'Stitching', 'Ready-made', 'Thread');
`;
