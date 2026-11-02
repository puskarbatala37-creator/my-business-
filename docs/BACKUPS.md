# Backups

## What is protected, and how

| Layer | What it covers | Protects against | Who does it |
|---|---|---|---|
| **1. Daily copies on the server** (built into Slay) | Everything in the database: orders, customers, payments, stock, supplier-bill details, team accounts, settings. One copy a day, the last **7** kept in `DATA_DIR/backups/` on the permanent disk (copies made before a restore are never removed). | Something deleted or changed by mistake; a damaged database file. | Automatic. |
| **1b. The daily copy by email** (built into Slay) | The same daily copy, compressed (`slay-backup-<date>.db.gz`), emailed to every owner. | Losing the server or its disk – a copy off the server every day without anyone remembering. | Automatic once email is set up (`SMTP_URL`, `MAIL_FROM` – DEPLOY.md Part 3). **More → Backups** shows when it was last sent, or why not. |
| **2. A copy off the server** (built into Slay) | The same data, as one small file `slay-backup-<date>.db.gz`. | Losing the server or its disk altogether. | An owner taps **More → Backups → Save a backup now**, then keeps the file in Google Drive / iCloud / email. Slay shows a reminder on the Home screen when the last one is more than 7 days old. |
| **3. Host's volume backups** (recommended) | The whole `/data` volume – database **and photos**. | Losing the server, including product and bill photos. | Turn on in the hosting dashboard (Railway: open the volume → *Backups*, if your plan offers it; choose daily). |

**Photos** (product colours, order items, supplier bills) are files on the server's disk, not inside layers 1–2.
Only layer 3 keeps them. Losing them doesn't lose any order or payment data.

## Restoring

**From the app (owners):** **More → Backups → Restore from a backup file**.

1. Choose the backup – a downloaded `slay-backup-….db.gz` or the one attached to a daily email.
2. Slay **only checks it** first and shows what's inside (orders, customers, products, bills,
   accounts, owners, last order). A file that isn't a Slay backup, or was made by a newer Slay, is
   refused. Nothing has changed yet.
3. Switch on *I want to restore this backup* → **Restore this backup**. Slay keeps the current data as
   `DATA_DIR/backups/before-restore-<time>.db`, swaps the backup in and restarts (up to a minute).
4. Sign in with an account from the backup. The team gets a "data was restored" notice.

On a brand-new, empty server there is no owner yet: create a **temporary** owner on the setup
screen first, then restore – the restore replaces it with the accounts from the backup.

If Slay doesn't come back by itself within a minute, restart it in the host's dashboard (Render:
**Manual Deploy → Restart service**) – the waiting backup is swapped in on that start.

**By hand (server access):** put the backup file in **`DATA_DIR/restore/`** (e.g. `/data/restore/`)
and restart Slay. Before opening the database Slay swaps it in, prints `[backups] Restored data from …`,
and keeps the data it replaced as `before-restore-<time>.db`, so a restore can itself be undone the
same way.

Everyone stays signed in only if their sign-in existed at the time of the backup; otherwise they sign in again.

If restoring the whole volume from the host's backups (layer 3), follow the host's own restore steps instead.
