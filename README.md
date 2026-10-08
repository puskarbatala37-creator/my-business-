# Slay – orders & stock

Order and inventory management for a two-person weekend clothing business that sells on Instagram, Facebook and TikTok.
It runs as an installable mobile web app (PWA), so one codebase works on **Android and iPhone**. Open it in the browser and choose
**Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: ⋮ → Install app). It then opens full-screen like a normal app.

## What it does

| Area | Highlights |
|---|---|
| **Logins** | Two separate accounts (username + password, bcrypt-hashed, http-only session cookie). |
| **Real-time sync** | Every change is pushed to both phones instantly (Server-Sent Events). If one partner sells the last unit, it shows as out of stock on the other phone right away. The server also checks stock inside a database transaction, so the same item can never be sold twice, even if both partners tap "Save" at the same moment. |
| **Catalog** | Category (e.g. *Sari*) → product/design (e.g. *Banarasi Silk*) → **colour variants**, each with its own stock count, photo, cost and selling price. Stock goes down automatically when an order is saved, and goes back up when an order is edited or cancelled. Every stock change is logged. |
| **Orders (invoices)** | Automatic invoice numbers (`SLAY-2026-0001`), order date, customer contact details with full order history, items (product + colour, qty, size, price, photo), notes, delivery tracking number, delivery due date, prep time, delivery charge and discount. **Payment:** paid in full / partially paid (shows paid *and* still owed) / unpaid (COD), with amount and method. **Fulfilment:** pending / sent. Includes a printable and shareable invoice. |
| **Voice entry (Nepali)** | Speak an order such as *"बनारसी रातो साडी दुई वटा ३५०० रुपैयाँ, एक हजार एडभान्स इसेवा, भोलि डेलिभरी, तयार गर्न दुई दिन, नाम सीता शर्मा फोन ९८४…"* and the form fills itself: item, qty, price, payment status, amount and method, delivery due date, prep time, customer name and phone. You always check the result before saving. |
| **Dashboard** | Sales for today, this month and the last 6 months, plus monthly and daily charts, profit (sales − item cost), money still to collect, orders to send, deliveries due soon, and low stock. |
| **Supplier bills** | Snap a photo of a supplier bill. It is timestamped automatically and is searchable by supplier, text and date, with spend totals for working out profit later. |
| **eSewa** | "Send eSewa payment link" on any order with money owed. The customer pays on eSewa; the server checks the signature, **confirms the payment directly with eSewa's status API**, and marks the order paid. If the customer never comes back to the page, a background job still catches the payment. Uses eSewa's sandbox (test mode) until you switch to production. |
| **Security alerts** | Both partners are notified (in the app, as a phone notification, and optionally via a webhook) about: repeated wrong passwords, account lockout (5 wrong attempts → 15 min), sign-ins from a new device, password changes, cancelling a paid order, many cancellations in an hour, large manual stock removals, and deleted supplier bills. Either partner can see every signed-in device and sign one out. |

Returns and exchanges are not built yet, but the data model is ready for them (see *Extending* below).

## Running it

Requires **Node.js 20.12+** (22 recommended).

```bash
npm install
npm run user:create -- teza "Teza"          # asks for a password (8+ characters)
npm run user:create -- partner "Partner"
npm run dev                                  # API on :3000, app on http://localhost:5173
```

To test on your phone during development, open `http://<your-computer-ip>:5173` on the same Wi-Fi.
(Voice input and notifications need HTTPS on a phone, so test those on a deployed copy.)

**Tests:** `npm test` covers stock and overselling, order editing and cancelling, payments, the dashboard, receipts, security alerts, the eSewa flow (with a mocked eSewa API), and the Nepali voice parser. **Type check:** `npm run typecheck`.

### Deploying

The production build is a single Node server that serves both the API and the app:

```bash
npm run build
cd server && NODE_ENV=production APP_URL=https://your-domain node dist/index.js
```

Or use Docker: `docker build -t slay . && docker run -p 3000:3000 -v slay-data:/data -e APP_URL=https://your-domain slay`.

Any host that runs Node or Docker and keeps a **persistent disk** will work: a small VPS, Railway, Render or Fly.io with a volume. Put it behind HTTPS, which these hosts usually provide. All data lives in `DATA_DIR`: the SQLite database plus uploaded photos. **Back up that folder.**
See `.env.example` for every setting.

To create users on a server: `cd server && node dist/cli/users.js create teza "Teza"`. To reset a password: `node dist/cli/users.js password teza`.

### Going live with eSewa

1. Get your merchant **product code** and **secret key** from eSewa for the business account.
2. Set `ESEWA_MODE=production`, `ESEWA_PRODUCT_CODE=…`, `ESEWA_SECRET_KEY=…`, and set `APP_URL` to your public HTTPS address.
3. Test one small real payment end to end before relying on it.

In test mode, use eSewa's published sandbox test accounts to pay. The integration follows eSewa's ePay v2 spec: an HMAC-SHA256-signed form post, a base64 signed response, and the transaction status API. Check it once against the live sandbox before going to production.

### Voice entry: how it works on each phone

- **Android (Chrome):** the phone's own speech recognition understands Nepali (`ne-NP`). It is free and needs no setup.
- **iPhone:** Safari's built-in recognition does not support Nepali. Either:
  - set `TRANSCRIBE_API_KEY` (any Whisper-compatible speech-to-text API) so recordings are converted on the server, or
  - tap the text box and use the keyboard's mic. Gboard supports Nepali voice typing on iPhone and Android.
- Either way, the text goes to the same parser. Teach it shop-specific words, such as a design name or a colour nickname, through the **Voice words** fields on categories, products and colours. No code changes are needed.

## Architecture

```
shared/   Domain vocabulary used by server and app (statuses, payment methods, money & date helpers)
server/   Node + Express + SQLite (better-sqlite3)
  src/core/        module system, event bus (live sync), HTTP helpers
  src/db/          connection + ordered migrations
  src/modules/     one folder per feature – each owns its routes and service:
                   auth, security, catalog, customers, orders, payments (eSewa),
                   receipts, dashboard, voice, uploads, live
web/      React + TypeScript (Vite) installable PWA
  src/features/    one folder per screen area (orders, stock, receipts, …)
  src/components/  shared UI (variant picker, voice input, photo capture, …)
```

These choices are what make future changes cheap:

- **Feature modules.** A new feature is a new folder in `server/src/modules`, added to `modules/index.ts`. Modules talk to each other through services (`ctx.services`) and events (`ctx.bus`), not by reaching into each other's tables.
- **Migrations.** Schema changes are new numbered files in `server/src/db/migrations`. They apply automatically on start, and existing data is kept.
- **Pluggable providers.** Payment gateways implement one interface (`payments/provider.ts`), so adding Khalti or Fonepay means adding one class. File storage, speech-to-text and alert delivery are each isolated in a single place too.
- **Ledgers, not overwritten numbers.** Stock changes (`stock_movements`) and money (`payments`) are append-only records, and totals are derived from them. That gives a full history and makes features like refunds straightforward.
- **Optimistic locking.** If both partners edit the same order at once, the second save is refused with "reload to see the latest" instead of silently overwriting.

### Extending: returns & exchanges (planned)

The model already has what this feature needs:
- `orders.state` reserves `returned` / `exchanged`, and `orders.related_order_id` links an exchange to its original order.
- `order_items.status` can mark single lines as returned or exchanged.
- `stock_movements.reason` reserves `return` / `exchange`, so restocking is one call to `CatalogService.give()`.
- Refunds can be negative rows in `payments`, and the order's payment status recalculates itself.

So the feature is: a new `returns` module, a migration if extra fields are needed (e.g. a return reason), and a screen. No rebuild is required.
