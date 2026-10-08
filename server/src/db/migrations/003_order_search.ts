export default /* sql */ `
-- Order search: remember each sold item's product type (category) at the time of sale,
-- so history stays searchable even if the catalog is renamed or reorganised later.
ALTER TABLE order_items ADD COLUMN category_name TEXT NOT NULL DEFAULT '';
UPDATE order_items SET category_name = COALESCE((
  SELECT c.name FROM variants v JOIN products p ON p.id = v.product_id JOIN categories c ON c.id = p.category_id
   WHERE v.id = order_items.variant_id), '');

CREATE INDEX idx_order_items_category ON order_items(category_name);
CREATE INDEX idx_orders_platform ON orders(platform);
CREATE INDEX idx_customers_name ON customers(name);
`;
