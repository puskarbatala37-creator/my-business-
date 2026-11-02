# Backups

## What is protected, and how

| Layer | What it covers | Protects against | Who does it |
|---|---|---|---|
| **1. Daily copies on the server** (built into Slay) | Everything: orders, customers, payments, stock, supplier-bill details, team accounts, settings (`backups/slay-<day>.db`) **and every photo** (`backups/photos-<day>/`). The last **7** days are kept on the permanent disk; copies made before a restore are never removed. | Something deleted or changed by mistake; a damaged database file; a photo removed by mistake. | Automatic. |
| **1b. The daily copy by email** (built into Slay) | Emailed to every owner: the data **and photos** as one zip (`slay-backup-<day>.zip`) while that's under 20 MB; above that, the data only (`slay-backup-<day>.db.gz`) and the email says the photos are in the manual backup. | Losing the server or its disk – a copy off the server every day, without anyone remembering. | Automatic once email is set up (`SMTP_URL`, `MAIL_FROM` – DEPLOY.md Part 3). **More → Backups** shows when it was last sent, with or without photos, or why not. |
| **2. Manual backup** (built into Slay) | One zip, `slay-backup-<date>.zip`: the database (`slay.db`), **every product, order and bill photo** (`uploads/…`) and a label (`slay-backup.json`). | Losing the server or its disk altogether. | An owner taps **More → Backups → Save a backup now** and keeps the file in Google Drive / iCloud / email. Slay reminds owners when the last one is more than 7 days old. |
| **3. Host's disk snapshots** | The whole `/data` disk. | Losing the server. | Render takes them daily (service → Disks). |

**Disk space.** Photos are shrunk on the phone before upload (longest side 1,400 px, JPEG), and they
never change afterwards – so each daily copy *hard-links* the photo files instead of copying them: a
photo uses disk space once however many daily copies include it (zipping JPEGs wouldn't make them
smaller). **More → Backups → Server disk** shows how full the disk is and what takes the space; it
warns from 80%, the Home screen shows a warning too, and owners get a notification from 90% (at most
once a day). To make room, increase the disk size in Render (service → Disks) – data and photos are kept.

## Restoring

**From the app (owners):** **More → Backups → Restore from a backup file**.

1. Choose the backup – a `slay-backup-….zip` (data and photos), or an older `slay-backup-….db.gz`
   (data only), from this page or a daily email.
2. Slay **only checks it** first and shows what's inside (orders, customers, products, bills, photos,
   accounts, owners, last order). A file that isn't a Slay backup, or was made by a newer Slay, is
   refused. Nothing has changed yet.
3. Switch on *I want to restore this backup* → **Restore this backup**. Slay keeps the current data as
   `DATA_DIR/backups/before-restore-<time>.db`, swaps the backup in, **adds its photos** (photos already
   on the server are never replaced or removed) and restarts (up to a minute).
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
