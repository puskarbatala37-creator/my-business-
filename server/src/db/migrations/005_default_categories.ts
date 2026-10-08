export default /* sql */ `
-- The shop's product types. Owners can add their own any time (e.g. "Shawl").
-- Existing categories with the same names are left as they are.
INSERT OR IGNORE INTO categories (name, voice_aliases, sort_order) VALUES
  ('Kurta',   'कुर्था, कुर्ता', 1),
  ('Sari',    'साडी, सारी',    2),
  ('Lehenga', 'लेहेंगा, लहंगा', 3);
`;
