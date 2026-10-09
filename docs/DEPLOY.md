# Putting Slay online (https) and connecting SMS

This takes about 30–45 minutes. You need a GitHub account (the code is already in
`puskarbatala37-creator/my-business-`), a card for the hosting bill, and later a Sparrow SMS account.

> **Why https matters:** phone notifications, fingerprint / face sign-in and "Add to Home Screen"
> only work when Slay is opened from a secure `https://` address. They cannot be tried before this.

---

## Part 1a – Deploy on Render

The repository has a `render.yaml` "Blueprint", so Render sets almost everything up by itself: the
Docker build, a server in Singapore (closest to Nepal), the health check, and a **1 GB permanent disk at
`/data`** where every order, photo and account lives. The `https://` address is picked up automatically.

> **Paid instance needed.** A permanent disk only works on a paid instance (the Blueprint uses
> *Starter*; check the current price on render.com/pricing). On Render's free instance the files are
> wiped on every restart and deploy, so **all orders would be lost** – don't use it for Slay.

1. **render.com → Sign in** (Google is fine). In *Account settings → Billing*, add a card.
2. **Connect GitHub:** top right **+ New → Blueprint**. Under *Connect a repository* click
   **GitHub → Connect** (or *Configure account*). On GitHub choose **Only select repositories →
   `my-business-`** → **Install**. You return to Render.
3. Next to **`puskarbatala37-creator/my-business-`** click **Connect**.
4. **Blueprint name:** `slay`. **Branch:** `claude/slay-order-inventory-app-gqde86`
   (the latest work is there). Render lists what it will create: a web service **slay** (Starter,
   Singapore) with a disk **slay-data**. Click **Deploy Blueprint** / **Apply**.
5. Wait for the first build (5–15 minutes). Open the **slay** service → **Logs**. When you see
   `Slay is running…` followed by
   `No accounts yet. Open the app and create the first owner account with setup code: 123456`,
   note the code.
6. At the top of the service page is the address, e.g. **`https://slay.onrender.com`**
   (it may have a few extra letters). Open it on your phone, enter the setup code and create Teza's
   owner account.
7. **More → Setup check** → "Secure web address (https)" should say **Set up**.

Every push to the branch redeploys automatically; the disk (data) is kept. With a disk, each deploy has
about a minute of downtime. **Backups:** Render takes daily snapshots of the disk (service → *Disks*);
also save Slay's own backup weekly (More → Backups, see [BACKUPS.md](BACKUPS.md)).
SMS, email and the other settings below go in the service's **Environment** tab instead of Railway's
*Variables* (Render redeploys after you save).

---

## Part 1b – Or deploy on Railway instead

Railway builds Slay straight from GitHub using the project's `Dockerfile`, gives it an `https://`
address automatically, and keeps the database on a persistent volume. (Use either Railway or Render, not
both. Any host works as long as it gives the app a **persistent disk** – without one, all orders are lost
on every restart.)

1. **Choose the code to deploy.** Slay's latest work is on the branch
   `claude/slay-order-inventory-app-gqde86`. Either merge it into `main` on GitHub, or pick that branch
   in step 4.
2. Go to **railway.com** → *Login* → *Login with GitHub*. Pick the **Hobby** plan (check the current
   price on Railway's pricing page; a small app like this normally stays within the base plan).
3. **New Project → Deploy from GitHub repo →** choose `my-business-`. If Railway asks, allow it to
   access that repository. Railway finds the `Dockerfile` and starts building (5–10 minutes the first time).
4. Open the service → **Settings**:
   - *Source → Branch*: the branch from step 1.
   - *Networking → Generate Domain*. You get an address like `https://my-business-production.up.railway.app`.
     **Copy it.** (A custom domain such as `slay.yourshop.com` can be added here instead – decide now,
     because fingerprint / face sign-ins are tied to the address and must be set up again if it changes.)
5. **Add a volume** (this is where every order, photo and account is stored):
   on the project canvas, *right-click the service → Attach volume* (or *+ New → Volume*), mount path **`/data`**.
6. **Variables** tab → add:

   | Name | Value |
   |---|---|
   | `APP_URL` | the https address from step 4, e.g. `https://my-business-production.up.railway.app` |
   | `ESEWA_MODE` | `test` (switch to `production` only when eSewa gives you merchant details) |

   Don't set `PORT` – Railway sets it and Slay uses it.
7. Railway redeploys. Open **Deployments → View logs**. You'll see:
   `No accounts yet. Open the app and create the first owner account with setup code: 123456`
8. Open your `https://` address on your phone, enter that setup code, and create Teza's owner account.
9. In Slay: **More → Setup check**. "Secure web address (https)" should now say **Set up**.

**Backups:** Slay copies its database every day and reminds owners to save a copy off the server
(More → Backups). Also turn on Railway's volume backups if your plan offers them (open the volume →
*Backups*, daily) – they include photos. See [BACKUPS.md](BACKUPS.md).

**Updating later:** every push to the chosen branch redeploys automatically; the volume (data) is kept.

---

## Part 2 – Sparrow SMS (text-message codes for Nepali numbers)

Sparrow SMS sends the codes for confirming phone numbers and "Forgot password?". Their sign-up
process and prices can change – follow what their site shows if it differs from this.

1. Go to **sparrowsms.com** → *Register / Sign up*. Create the account and verify your email/phone.
2. **Buy credit.** SMS is prepaid; top up a small amount (enough for a few hundred messages) from the
   dashboard. Their support (shown on the site) can help with payment options in Nepal.
3. **Sender identity (the "From" name).** Messages are sent under a sender identity approved by Sparrow /
   the telecoms (e.g. `SLAY`, or the shop's name). Request one from the dashboard or their support;
   approval may need business documents. Until it's approved, ask Sparrow which identity your account
   can use for testing.
4. **API token.** In the dashboard, find the developer / API section and generate a **token**.
   If there is an "allowed IP addresses" setting, leave it off: Railway's outgoing address can change.
   (If Sparrow insists on a fixed IP, tell us – Slay would then need a host with a fixed address.)
5. In **Railway → Variables**, add:

   | Name | Value |
   |---|---|
   | `SMS_PROVIDER` | `sparrow` |
   | `SPARROW_SMS_TOKEN` | the token from step 4 |
   | `SPARROW_SMS_FROM` | the approved sender identity from step 3 |

   Enter the token only in Railway – don't paste it into chats or emails.
6. After the redeploy: **More → Setup check → Text messages → Send test SMS**.
   - Green + the text arrives on the phone → SMS works end to end.
   - Red → the exact message from Sparrow is shown (e.g. *Invalid Token*, *Invalid Sender*, *insufficient
     credit*). Fix that in Sparrow / Railway and try again (up to 5 tests an hour).

Once this works, new team members must confirm their phone number by code, and "Forgot password?"
sends real codes.

**Twilio instead?** Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`
(see `.env.example`). Sparrow is usually cheaper and more reliable for Nepali numbers.

---

## Part 3 – Optional extras

| What | Variables | Notes |
|---|---|---|
| Email copies of security alerts | `SMTP_URL`, `MAIL_FROM` | Gmail: turn on 2-step verification, create an *App password*, then `SMTP_URL=smtps://you%40gmail.com:APP-PASSWORD@smtp.gmail.com`. Test with *Setup check → Send test email*. |
| Nepali voice entry on iPhone | `TRANSCRIBE_API_KEY` (+ `TRANSCRIBE_API_URL`, `TRANSCRIBE_MODEL`) | Android Chrome understands Nepali speech itself; iPhones need a speech-to-text service (OpenAI Whisper or compatible) for Nepali. English works on both without it. |
| Real eSewa payments | `ESEWA_MODE=production`, `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY` | From your eSewa merchant account. |

Phone notifications need **no account or keys** – Slay creates its own and Google / Apple deliver them.

Then work through **[PHONE-TEST.md](PHONE-TEST.md)** on real phones.
