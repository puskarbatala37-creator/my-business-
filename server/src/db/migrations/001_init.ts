export default /* sql */ `
-- ── Users, sessions & security ───────────────────────────────────────────
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id           INTEGER PRIMARY KEY,
  token_hash   TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    TEXT,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at   TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE known_devices (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  TEXT NOT NULL,
  label      TEXT,
  first_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, device_id)
);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY,
  username   TEXT NOT NULL,
  user_id    INTEGER,
  ip         TEXT,
  user_agent TEXT,
  success    INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_attempts_time ON login_attempts(created_at);

CREATE TABLE security_alerts (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL,
  severity   TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  message    TEXT NOT NULL,
  meta       TEXT,                            -- JSON
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE alert_reads (
  alert_id INTEGER NOT NULL REFERENCES security_alerts(id) ON DELETE CASCADE,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (alert_id, user_id)
);

CREATE TABLE push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  keys       TEXT NOT NULL, -- JSON {p256dh, auth}
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE activity_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_activity_time ON activity_log(created_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- ── Catalog: category (e.g. Sari) → product (design) → colour variant ────
CREATE TABLE categories (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  voice_aliases TEXT NOT NULL DEFAULT '', -- comma separated words (e.g. Nepali) for voice entry
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE products (
  id            INTEGER PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES categories(id),
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  sizes         TEXT NOT NULL DEFAULT '', -- comma separated size options, e.g. "S,M,L,Free"
  voice_aliases TEXT NOT NULL DEFAULT '',
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE variants (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  color         TEXT NOT NULL,
  sku           TEXT,
  stock         INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  cost          REAL NOT NULL DEFAULT 0,  -- what one unit cost to make / source
  price         REAL NOT NULL DEFAULT 0,  -- default selling price
  photo         TEXT,
  voice_aliases TEXT NOT NULL DEFAULT '',
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_variants_product ON variants(product_id);

-- Every stock change is recorded, so returns/exchanges can later just add rows.
CREATE TABLE stock_movements (
  id            INTEGER PRIMARY KEY,
  variant_id    INTEGER NOT NULL REFERENCES variants(id),
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,  -- see STOCK_REASONS in @slay/shared
  order_id      INTEGER REFERENCES orders(id),
  order_item_id INTEGER,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_stock_movements_variant ON stock_movements(variant_id);

-- ── Customers & orders ───────────────────────────────────────────────────
CREATE TABLE customers (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  address       TEXT NOT NULL DEFAULT '',
  social_handle TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX idx_customers_phone ON customers(phone) WHERE phone IS NOT NULL AND phone <> '';

CREATE TABLE orders (
  id                 INTEGER PRIMARY KEY,
  invoice_no         TEXT NOT NULL UNIQUE,
  customer_id        INTEGER NOT NULL REFERENCES customers(id),
  order_date         TEXT NOT NULL,          -- YYYY-MM-DD (Nepal time)
  platform           TEXT NOT NULL DEFAULT 'instagram',
  state              TEXT NOT NULL DEFAULT 'active',   -- see ORDER_STATES
  fulfillment_status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent
  payment_status     TEXT NOT NULL DEFAULT 'unpaid',   -- paid | partial | unpaid (derived)
  payment_method     TEXT,                             -- main/expected method
  subtotal           REAL NOT NULL DEFAULT 0,
  delivery_charge    REAL NOT NULL DEFAULT 0,
  discount           REAL NOT NULL DEFAULT 0,
  total              REAL NOT NULL DEFAULT 0,
  amount_paid        REAL NOT NULL DEFAULT 0,          -- derived from payments
  notes              TEXT NOT NULL DEFAULT '',
  tracking_number    TEXT NOT NULL DEFAULT '',
  delivery_due_date  TEXT,
  prep_time_days     INTEGER,
  sent_at            TEXT,
  related_order_id   INTEGER REFERENCES orders(id),     -- future: exchange/return links
  version            INTEGER NOT NULL DEFAULT 1,        -- optimistic locking between the two users
  created_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE TABLE order_items (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  variant_id   INTEGER REFERENCES variants(id),
  product_name TEXT NOT NULL,   -- snapshot at time of sale
  color        TEXT NOT NULL,
  size         TEXT NOT NULL DEFAULT '',
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  unit_price   REAL NOT NULL,
  unit_cost    REAL NOT NULL DEFAULT 0, -- snapshot for profit calculations
  photo        TEXT,
  status       TEXT NOT NULL DEFAULT 'sold' -- future: returned | exchanged
);
CREATE INDEX idx_order_items_order ON order_items(order_id);

-- A payment is a ledger row. Refunds can later be negative rows.
CREATE TABLE payments (
  id           INTEGER PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount       REAL NOT NULL,
  method       TEXT NOT NULL,
  provider_ref TEXT,
  note         TEXT NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_order ON payments(order_id);

-- Online payment attempts (eSewa today; other gateways later).
CREATE TABLE payment_requests (
  id               INTEGER PRIMARY KEY,
  token            TEXT NOT NULL UNIQUE,  -- public link token
  provider         TEXT NOT NULL,         -- esewa
  order_id         INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount           REAL NOT NULL,
  transaction_uuid TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending', -- pending | complete | failed | expired
  provider_ref     TEXT,
  raw_response     TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at     TEXT
);

-- ── Stock purchase receipts ──────────────────────────────────────────────
CREATE TABLE receipts (
  id          INTEGER PRIMARY KEY,
  photo       TEXT NOT NULL,
  captured_at TEXT NOT NULL,              -- when the photo was taken
  supplier    TEXT NOT NULL DEFAULT '',
  amount      REAL NOT NULL DEFAULT 0,
  category    TEXT NOT NULL DEFAULT '',   -- e.g. fabric, thread, ready stock
  notes       TEXT NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_receipts_captured ON receipts(captured_at);
`;
