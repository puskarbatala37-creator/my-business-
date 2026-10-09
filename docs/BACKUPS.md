# Backups

## What is protected, and how

| Layer | What it covers | Protects against | Who does it |
|---|---|---|---|
| **1. Daily copies on the server** (built into Slay) | Everything in the database: orders, customers, payments, stock, supplier-bill details, team accounts, settings. One copy a day, the last **14 days** kept in `DATA_DIR/backups/`. | Something deleted or changed by mistake; a damaged database file. | Automatic. |
| **2. A copy off the server** (built into Slay) | The same data, as one small file `slay-backup-<date>.db.gz`. | Losing the server or its disk altogether. | An owner taps **More → Backups → Save a backup now**, then keeps the file in Google Drive / iCloud / email. Slay shows a reminder on the Home screen when the last one is more than 7 days old. |
| **3. Host's volume backups** (recommended) | The whole `/data` volume – database **and photos**. | Losing the server, including product and bill photos. | Turn on in the hosting dashboard (Railway: open the volume → *Backups*, if your plan offers it; choose daily). |

**Photos** (product colours, order items, supplier bills) are files on the server's disk, not inside layers 1–2.
Only layer 3 keeps them. Losing them doesn't lose any order or payment data.

## Restoring

1. Pick the backup: a file from `DATA_DIR/backups/` (`slay-2026-10-09.db`) or a downloaded `slay-backup-….db.gz`.
2. Put that file in **`DATA_DIR/restore/`** (on Railway: `/data/restore/`, e.g. via the Railway CLI's shell into the service).
3. Restart Slay.

Before opening the database, Slay swaps the backup in and prints
`[backups] Restored data from …` in the log. The data it replaced is kept as
`DATA_DIR/backups/before-restore-<time>.db`, so a restore can itself be undone the same way.
A file that isn't a Slay backup is refused and nothing changes.

Everyone stays signed in only if their sign-in existed at the time of the backup; otherwise they sign in again.

If restoring the whole volume from the host's backups (layer 3), follow the host's own restore steps instead.
