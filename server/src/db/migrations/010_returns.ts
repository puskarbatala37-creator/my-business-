export default /* sql */ `
-- Returns, exchanges and refunds. All optional: nothing changes for an order until someone records one.

-- Whether a product can normally be taken back and sold again. Off by default: made-to-order
-- pieces (e.g. kurtas cut to the customer's size) can't be resold once altered. It only sets the
-- default for "put back in stock" when a return is recorded – the person can always change it.
ALTER TABLE products ADD COLUMN returnable INTEGER NOT NULL DEFAULT 0;

-- How many pieces of a line came back, and how many of those went back into stock.
-- The order's value counts only the pieces kept (quantity - returned_qty).
ALTER TABLE order_items ADD COLUMN returned_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN restocked_qty INTEGER NOT NULL DEFAULT 0;
-- A line added as the replacement in an exchange points at that exchange.
ALTER TABLE order_items ADD COLUMN return_id INTEGER;

-- One row per return or exchange recorded on an order.
CREATE TABLE order_returns (
  id          INTEGER PRIMARY KEY,
  order_id    INTEGER NOT NULL REFERENCES orders(id),
  kind        TEXT NOT NULL CHECK (kind IN ('return', 'exchange')),
  reason      TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_order_returns_order ON order_returns(order_id);

CREATE TABLE order_return_items (
  id             INTEGER PRIMARY KEY,
  return_id      INTEGER NOT NULL REFERENCES order_returns(id),
  order_item_id  INTEGER NOT NULL REFERENCES order_items(id),
  quantity       INTEGER NOT NULL CHECK (quantity > 0),
  restocked      INTEGER NOT NULL DEFAULT 0 CHECK (restocked >= 0)
);
CREATE INDEX idx_order_return_items_return ON order_return_items(return_id);

-- Refunds are payment rows with a negative amount; this marks them (and links one made for a return).
ALTER TABLE payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment';
ALTER TABLE payments ADD COLUMN return_id INTEGER;
UPDATE payments SET kind = 'refund' WHERE amount < 0;
`;
