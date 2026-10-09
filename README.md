# Slay – orders & stock

Order and inventory management for a small clothing business that sells on Instagram, Facebook and TikTok. It is built for any size of team, not just two people.
It runs as an installable app (PWA), so one codebase works on **Android and iPhone**. The first time someone opens the link in their
browser, Slay offers to install itself: one tap on Android, or a short step-by-step guide on iPhone (Share → Add to Home Screen).
After that it opens from the home screen full-screen, with its own icon and launch screen, like any app from the store.

## What it does

| Area | Highlights |
|---|---|
| **Logins** | Everyone **signs in with their email address**, which is also where security notifications go. **Fingerprint or face recognition is the main way to sign in** (Face ID / Touch ID on iPhone, fingerprint or face unlock on Android) on any phone that supports it, and **email + password is always the fallback**. After the first password sign-in on a phone, the app offers to turn on biometrics. Biometric data never leaves the phone: it uses standard passkeys (WebAuthn), and the server only receives a cryptographic confirmation. |
| **Account recovery** | Every account has a **mobile number**, added during setup and confirmed with a texted code. **Forgot password?** on the sign-in screen texts a 6-digit code to that number. The code resets the password, unlocks a locked account and signs out every other device, and the whole team is notified. Codes expire after 10 minutes and allow 5 tries. Sending is rate-limited (one code a minute, five an hour). The form never reveals whether an email has an account. Changing your sign-in email or recovery phone also notifies the team. |
| **Team** | As many accounts as you need. **New people can create their own account** with **New here? Create an account** on the sign-in screen (name, email, mobile number, password). Owners choose who can sign up under **More → Team**: *anyone, with owner approval* (the default; the owners are notified and approve or decline each request under Team), *anyone with the link, straight away*, or *only people owners add*. Owners can also add someone directly with **Add team member** (name, email and a starting password). **Owners** can approve sign-ups, correct a member's email, reset passwords, and switch accounts off or back on. **Members** can do all the daily work (orders, stock, bills). Switching someone off signs them out everywhere immediately, and their past orders are kept. |
| **Real-time sync** | Every change is pushed to every team member's phone instantly (Server-Sent Events). If someone sells the last unit, it shows as out of stock on everyone else's phone right away. The server also checks stock inside a database transaction, so the same item can never be sold twice, even if two people tap "Save" at the same moment. |
| **Catalog** | Category → product/design (e.g. *Banarasi Silk*) → **colour variants**, each with its own stock count, photo, cost and selling price. **Kurta, Sari and Lehenga** are set up from the start. **+ New category** on the Add product screen adds a new product type on the spot, for anything you start selling later. When adding a product you enter the **total pieces in stock** up front: with one colour it all goes to that colour, and with several the app shows what's left to assign (with a **Split evenly** button) and won't save until the counts match. Stock goes down automatically when an order is saved, and goes back up when an order is edited or cancelled. Every stock change is logged. |
| **Orders (invoices)** | Automatic invoice numbers (`SLAY-2026-0001`), order date, **where the order came from (TikTok, Facebook, Instagram or WhatsApp). This is required, and shown as a badge on every order, the order screen and the invoice**, customer contact details with full order history, items (product + colour, qty, size, price, photo; when a line has more than one piece, tap **Different size for each piece** to give each its own size, e.g. two kurtas in sizes 42 and 41 on the same order, shown as *Sizes 42, 41*), notes, delivery tracking number, delivery due date, prep time, delivery charge and discount. **Payment:** paid in full / partially paid (shows paid *and* still owed) / unpaid (COD), with amount and method. **Fulfilment:** pending / sent. Every order has an invoice with **Share, Print and Save**. Share sends it as a **PDF** (WhatsApp, Viber, email), a **picture** (Instagram, Messenger, TikTok) or a **text message**. Save puts a PDF or PNG copy on the phone (Downloads on Android; *Save to Files / Photos* on iPhone). Print opens the phone's print screen. The files are made on the phone itself, so this works offline too. If a phone can't share files, the file is saved instead. If sharing and copying are both blocked, the text is shown ready to copy by hand. |
| **Order history search** | Search all orders by **customer name** (or phone, invoice number, tracking number, product or colour), and filter by **order date** (today, yesterday, last 7 days, this month, last 6 months, or any date range or single day), **product type** (Sari, Kurta…), **platform**, and payment or delivery status. Filters combine. The screen shows how many orders match and their total value. Each sold item remembers its product type, so old orders stay searchable even after the catalog is renamed. |
| **Voice entry, one field at a time (Nepali + English)** | Every field in the order form – and in the payment, sent, stock-count, product and supplier-bill forms – has its own small **mic**. Tap it, say just that value, and only that field fills, read as what the field expects: **dates** ("October 10", "अक्टोबर १०", "tomorrow", "भोलि", "next Friday", "in 3 days"; delivery dates look ahead, the order date looks back), **sizes** from that product's own size list ("42", "बयालीस", "medium"), **amounts and quantities** ("पच्चीस सय", "two thousand five hundred", "दुई"), **products** from the catalog by name and colour ("black cotton kurta", "मरुन कटन कुर्ता"; if several match, you choose), **order source**, **payment status** and **method** ("TikTok", "cash on delivery", "इसेवा"), **phone and tracking numbers** digit by digit, and names, address and notes as said. A bar shows what was heard, with a नेपाली / English switch that is remembered. Anything that doesn't fit the field ("44" for a product that comes in 40–42, a Nepali-calendar date) is explained and nothing is changed. |
| **Dashboard** | Sales for today, this month and the last 6 months, plus monthly and daily charts, profit (sales − item cost, leaving out delivery charges, which go to the courier), money still to collect, orders to send, deliveries due soon, and low stock. |
| **Supplier bills** | Snap a photo of a supplier bill. It is timestamped automatically and is searchable by supplier, text and date, with spend totals for working out profit later. Pick what was bought with one tap: **Fabric, Stitching, Ready-made or Thread**, or **+ New type** to type your own (e.g. *Buttons & lace*). A new type is saved for the whole team and offered on every bill after that, never duplicated by different capitalisation, and can be removed from the list again (bills already saved keep it). |
| **eSewa** | "Send eSewa payment link" on any order with money owed. The customer pays on eSewa; the server checks the signature, **confirms the payment directly with eSewa's status API**, and marks the order paid. If the customer never comes back to the page, a background job still catches the payment. Uses eSewa's sandbox (test mode) until you switch to production. |
| **Installed app (PWA)** | Custom Slay icon in every size Android and iPhone ask for (including Android's adaptive "maskable" and themed icons), a branded launch screen on both (no white flash), full-screen with no browser bars, and a status bar in Slay's colour. Long-press the icon on Android for **New order / Orders / Stock** shortcuts. **Install prompt:** on first open in a browser, a sheet explains how to install for that exact phone and browser: a one-tap **Install** button where supported, iPhone steps with pictures of the buttons, and "open in Safari/Chrome first" for links opened inside Instagram, Facebook or TikTok. It can be reopened any time from **More → Install the Slay app**. **Feel:** screens slide in when going deeper and back when returning, tabs cross-fade, sheets slide up and can be swiped down, and buttons, rows and tabs react to touch. There is no accidental text selection (except in fields, addresses and tracking numbers), and no double-tap or pinch zoom. Motion is reduced automatically if the phone's *Reduce motion* setting is on. |
| **Offline** | The app itself is stored on the phone, so it opens instantly even with no signal. Recently viewed orders, stock, customers and the dashboard are saved too (and the photos you've seen), so they can still be looked at offline. A strip under the title says when you're offline and when you're back. Saving needs a connection: new orders and changes are **never queued offline**, because stock has to be checked live so nothing is sold twice. If you try, you get a clear "you're offline, this wasn't saved" message. Saved data belongs to whoever is signed in and is wiped from the phone on sign-out. |
| **Security notifications** | Only for things worth knowing. Every team member is notified (in the app, as a **real phone notification that arrives even when Slay is closed or the phone is locked**, by email, and optionally via a webhook) when **a device signs in for the first time**, or when something **suspicious** happens: repeated wrong passwords, account lockout (5 wrong attempts → 15 min), blocked sign-in floods, someone using a switched-off account, cancelling a paid order, many cancellations in an hour, or large manual stock removals. **Once a device has signed in successfully it is trusted, and its everyday sign-ins are silent.** Routine activity (team changes, password changes, biometrics turned on, deleted bills) goes into a quiet activity log under Security, with no notification. Anyone can see the trusted devices and remove one. A removed device is signed out, and its next sign-in notifies everyone again. | **Turning them on or off:** after signing in, Slay offers once to turn on notifications for that phone. Each person can switch **phone notifications** and **email** on or off for themselves under **More → Notifications** (also shown on the Security screen), and send a test notification. Switching them off is recorded in the team's activity log, and every alert is still listed under the bell. A phone only gets notifications while someone is signed in on it: signing out (or being signed out from Security) stops them straight away. On iPhone, notifications need Slay added to the Home Screen (iOS 16.4 or newer); the settings screen explains this.

Returns and exchanges are not built yet, but the data model is ready for them (see *Extending* below).

## Opening the app

| Where | How |
|---|---|
| **On your computer** | `npm install`, then `npm run dev`, then open **http://localhost:5173**. On first start, the app asks you to create the owner account; the setup code is printed in the terminal. |
| **On your phone, same Wi-Fi** | While `npm run dev` is running, open `http://<your-computer's-IP>:5173` on the phone. Vite prints this "Network" address when it starts. |
| **For real use, anywhere** | Deploy it (see *Deploying* below) and open your own `https://…` address on each phone. Slay offers to install itself; follow the prompt (or **More → Install the Slay app**). Installing needs HTTPS. |
| **Quick look, no setup** | `npm run build:demo -w web` builds a self-contained **demo preview** in `web/dist-demo`. The whole app, server included, runs inside the browser on sample data, so it can be hosted as static files (`npm run preview:demo -w web` serves it locally). Fingerprint sign-in, notifications and eSewa need the real server, so they don't work in the demo. No texts or emails are sent: one-time codes are shown on screen instead. In the demo anyone can create an account and get straight in. |

## Running it

Requires **Node.js 20.12+** (22 recommended).

```bash
npm install
npm run dev                                  # API on :3000, app on http://localhost:5173
```

**First start:** open the app. It asks you to create the first **owner** account (name, email, mobile number, password), using a 6-digit setup code that the server prints in its log. The code stops anyone else who finds the new site first from claiming it. After that, add everyone else in the app under **More → Team**. No command line is needed.
(You can also use the command line: `npm run user:create -- teza@gmail.com "Teza" owner 98XXXXXXXX`.)

**Upgrading from a version with usernames:** existing accounts keep signing in with their old username. The first time they do, the app asks them for their email and mobile number, and from then on they sign in with the email.

To test on your phone during development, open `http://<your-computer-ip>:5173` on the same Wi-Fi.
(Voice input, notifications and fingerprint/face sign-in need HTTPS on a phone, so test those on a deployed copy.)

**Tests:** `npm test` covers stock and overselling, order editing and cancelling, payments, the dashboard, receipts, security alerts, the eSewa flow (with a mocked eSewa API), and the Nepali voice parser. **Type check:** `npm run typecheck`.

### Deploying

**Step-by-step guide (Railway + Sparrow SMS): [docs/DEPLOY.md](docs/DEPLOY.md). Then test on real phones with [docs/PHONE-TEST.md](docs/PHONE-TEST.md).** Owners can check what is set up, and send a real test SMS, test email and test notification, under **More → Setup check**.

The production build is a single Node server that serves both the API and the app:

```bash
npm run build
cd server && NODE_ENV=production APP_URL=https://your-domain node dist/index.js
```

Or use Docker: `docker build -t slay . && docker run -p 3000:3000 -v slay-data:/data -e APP_URL=https://your-domain slay`.

Any host that runs Node or Docker and keeps a **persistent disk** will work: a small VPS, Railway, Render or Fly.io with a volume. Put it behind HTTPS, which these hosts usually provide. All data lives in `DATA_DIR`: the SQLite database plus uploaded photos.

**Backups:** Slay copies the database every day (last 14 days kept on the server), owners save an off-server copy under **More → Backups** (with a weekly reminder), and restoring is dropping a backup into `DATA_DIR/restore/` and restarting. Also turn on the host's volume backups, which include photos. Details: [docs/BACKUPS.md](docs/BACKUPS.md).
See `.env.example` for every setting.

Team members are normally managed in the app, and anyone locked out can use **Forgot password?**. If even that fails (no phone, lost phone), an owner can reset the password under Team, and the command line still works on the server: `node dist/cli/users.js create <email> "<Name>" owner <phone>`, or `node dist/cli/users.js password <email>`.

### Text messages and email

- **SMS (recovery codes):** set `SMS_PROVIDER=sparrow` with `SPARROW_SMS_TOKEN` and `SPARROW_SMS_FROM` (Sparrow SMS, Nepal), or `SMS_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM`. Until one is set, codes are written to the server log instead of being texted. That's fine for trying the app, but people can't recover their own accounts that way, so the app doesn't ask anyone to confirm their phone until SMS is set up. After you set up SMS, send yourself one recovery code to check it arrives.
- **Email (security notifications):** set `SMTP_URL` (e.g. `smtps://you%40gmail.com:app-password@smtp.gmail.com`) and `MAIL_FROM`. Every active team member is then emailed when a security notification is raised.

**Fingerprint / face sign-in and your domain:** passkeys are tied to the web address in `APP_URL`. If you move the app to a different domain, everyone signs in once with their password and turns biometrics on again. Nothing else is lost.

### Going live with eSewa

1. Get your merchant **product code** and **secret key** from eSewa for the business account.
2. Set `ESEWA_MODE=production`, `ESEWA_PRODUCT_CODE=…`, `ESEWA_SECRET_KEY=…`, and set `APP_URL` to your public HTTPS address.
3. Test one small real payment end to end before relying on it.

In test mode, use eSewa's published sandbox test accounts to pay. The integration follows eSewa's ePay v2 spec: an HMAC-SHA256-signed form post, a base64 signed response, and the transaction status API. Check it once against the live sandbox before going to production.

### Voice entry: how it works on each phone

- **Android (Chrome):** the phone's own speech recognition handles both Nepali (`ne-NP`) and English, free and with no setup. Tap **नेपाली** or **English** at any time, even mid-sentence, and recognition continues in that language.
- **iPhone:** English works with the phone's own recognition. Safari can't recognise Nepali itself, so either:
  - set `TRANSCRIBE_API_KEY` (any Whisper-compatible speech-to-text API) so recordings are converted on the server, or
  - tap the text box and use the keyboard's mic. Gboard supports Nepali voice typing on iPhone and Android.
- **Auto / mixed:** when `TRANSCRIBE_API_KEY` is set, an extra **Auto / mixed** option appears. The server works out which language, or mix of languages, was spoken, so no switching is needed.
- Whichever route the speech takes, the text goes to the same parser, which understands Nepali, English and a mix of both. Teach it shop-specific words, such as a design name or a colour nickname, through the **Voice words** fields on categories, products and colours. No code changes are needed.

## Architecture

```
shared/   Domain vocabulary used by server and app (statuses, payment methods, money & date helpers)
server/   Node + Express + SQLite (better-sqlite3)
  src/core/        module system, event bus (live sync), HTTP helpers
  src/db/          connection + ordered migrations
  src/modules/     one folder per feature – each owns its routes and service:
                   auth (email sign-in, passkeys, recovery codes, team), messaging (SMS, email), security, catalog, customers, orders, payments (eSewa),
                   receipts, dashboard, voice, uploads, live
web/      React + TypeScript (Vite) installable PWA
  src/features/    one folder per screen area (orders, stock, receipts, …)
  src/components/  shared UI (variant picker, voice input, photo capture, install prompt, …)
  src/lib/         API client, live sync, offline cache (persist.ts), PWA helpers (pwa.ts)
  public/          manifest, icons, iPhone/iPad launch screens, service worker (sw.js)
```

The service worker (`web/public/sw.js`) stores the app shell. The build writes the exact file list and a version into it, so installed phones update themselves the next time the app goes to the background. It never caches `/api` responses: offline data is kept by the app per signed-in person (`web/src/lib/persist.ts`), so one person's data is never served to another. Icons and launch screens are PNGs generated from the SVG artwork in `web/public/icons/`. If the artwork changes, regenerate all the sizes listed in `manifest.webmanifest` and `index.html`.

These choices are what make future changes cheap:

- **Feature modules.** A new feature is a new folder in `server/src/modules`, added to `modules/index.ts`. Modules talk to each other through services (`ctx.services`) and events (`ctx.bus`), not by reaching into each other's tables.
- **Migrations.** Schema changes are new numbered files in `server/src/db/migrations`. They apply automatically on start, and existing data is kept.
- **Pluggable providers.** Payment gateways implement one interface (`payments/provider.ts`), so adding Khalti or Fonepay means adding one class. File storage, speech-to-text and alert delivery are each isolated in a single place too.
- **Ledgers, not overwritten numbers.** Stock changes (`stock_movements`) and money (`payments`) are append-only records, and totals are derived from them. That gives a full history and makes features like refunds straightforward.
- **Optimistic locking.** If two people edit the same order at once, the second save is refused with "reload to see the latest" instead of silently overwriting.

### Extending: returns & exchanges (planned)

The model already has what this feature needs:
- `orders.state` reserves `returned` / `exchanged`, and `orders.related_order_id` links an exchange to its original order.
- `order_items.status` can mark single lines as returned or exchanged.
- `stock_movements.reason` reserves `return` / `exchange`, so restocking is one call to `CatalogService.give()`.
- Refunds can be negative rows in `payments`, and the order's payment status recalculates itself.

So the feature is: a new `returns` module, a migration if extra fields are needed (e.g. a return reason), and a screen. No rebuild is required.
