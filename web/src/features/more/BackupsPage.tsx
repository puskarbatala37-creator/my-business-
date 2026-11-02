import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Loading, Toggle, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime, shortDate } from '../../lib/format';
import { useAuth } from '../../lib/auth';
import { clearSavedQueries } from '../../lib/persist';

export interface BackupInfo {
  keepDays: number;
  backups: { name: string; day: string; size: number; createdAt: string; photos: number | null }[];
  lastDownload: { at: string; by: string } | null;
  email: { configured: boolean; last: { day: string; at: string; ok: boolean; to?: string[]; error?: string; photos?: boolean } | null };
  disk: { total: number | null; free: number | null; usedPct: number | null; photos: number; backups: number; database: number; warn: boolean };
}

/** "340 MB", "1.0 GB". */
export const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${Math.round(n / 1e6)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

interface RestoreSummary {
  accounts: number;
  orders: number;
  cancelled: number;
  customers: number;
  products: number;
  bills: number;
  photos: number;
  owners: { name: string; email: string }[];
  lastOrderDate: string | null;
  lastChange: string | null;
}

/** Days since an owner last saved a copy off the server (null = never). */
export const daysSinceDownload = (b?: BackupInfo) => (b?.lastDownload ? Math.floor((Date.now() - Date.parse(b.lastDownload.at)) / 86_400_000) : null);

/** Owners only: is everything backed up, and save a copy to this phone / computer. */
export function useBackups() {
  const { me } = useAuth();
  return useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<BackupInfo>('/api/backups'),
    enabled: me?.user.role === 'owner' && import.meta.env.VITE_DEMO !== '1',
    staleTime: 5 * 60_000,
  });
}

export function BackupsPage() {
  const q = useBackups();
  const qc = useQueryClient();
  const b = q.data;
  const days = daysSinceDownload(b);
  const latest = b?.backups[0];
  return (
    <>
      <TopBar title="Backups" back="/more" />
      {!b ? (
        <Loading error={q.error} retry={q.refetch} what="backup list" />
      ) : (
        <main className="page stack" style={{ paddingTop: 12 }}>
          <DiskCard d={b.disk} />

          <section className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <h2>Automatic copies on the server</h2>
              <span className={`badge ${latest ? 'good' : 'warn'}`}>{latest ? 'On' : 'Starting'}</span>
            </div>
            <div className="small muted">
              Every day Slay copies all orders, customers, payments, stock, supplier bills, accounts <strong>and photos</strong>, and keeps the last {b.keepDays}{' '}
              days on the permanent disk. A photo is stored once however many days include it, so the copies take little extra space.
            </div>
            {latest ? (
              <div className="small">
                Latest copy: <strong>{dateTime(latest.createdAt)}</strong>
                {latest.photos !== null ? ` with ${latest.photos} photo${latest.photos === 1 ? '' : 's'}` : ''} · {b.backups.length} kept
              </div>
            ) : (
              <div className="small">The first copy is made within the hour.</div>
            )}
          </section>

          <section className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <h2>Emailed to the owners every day</h2>
              <span className={`badge ${b.email.configured ? (b.email.last?.ok ? 'good' : 'warn') : 'warn'}`}>
                {!b.email.configured ? 'Not set up' : b.email.last?.ok ? 'On' : b.email.last ? 'Problem' : 'Starting'}
              </span>
            </div>
            <div className="small muted">
              After each daily copy, Slay emails it to every owner – the data and photos as one zip while that’s under 20 MB; above that, the data only (the
              photos are then in “Save a backup now” below).
            </div>
            {!b.email.configured ? (
              <div className="small">Email isn’t set up on the server yet (SMTP_URL – see DEPLOY.md, Part 3). Until then, save a copy below once a week.</div>
            ) : b.email.last?.ok ? (
              <div className="small">
                Last emailed {dateTime(b.email.last.at)} to {b.email.last.to?.join(', ')} – {b.email.last.photos ? 'with photos' : 'data only (photos too big for email)'}.
              </div>
            ) : b.email.last ? (
              <div className="small" style={{ color: 'var(--bad)' }}>
                The last email didn’t go out: {b.email.last.error}
              </div>
            ) : null}
          </section>

          <section className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <h2>Copy on your phone or computer</h2>
              <span className={`badge ${days !== null && days <= 7 ? 'good' : 'warn'}`}>
                {days === null ? 'Never saved' : days === 0 ? 'Saved today' : `${days} day${days === 1 ? '' : 's'} ago`}
              </span>
            </div>
            <div className="small muted">
              The copies above live on the same server as Slay. Save one somewhere else once a week – e.g. Google Drive, iCloud or email it to yourself – so nothing
              is lost even if the server itself has a problem.
            </div>
            {b.lastDownload && (
              <div className="small">
                Last saved {dateTime(b.lastDownload.at)}
                {b.lastDownload.by ? ` by ${b.lastDownload.by}` : ''}.
              </div>
            )}
            <a
              className="btn primary block"
              href="/api/backups/download"
              download
              onClick={() => setTimeout(() => qc.invalidateQueries({ queryKey: ['backups'] }), 3000)}
            >
              <Icon name="download" size={18} /> Save a backup now
            </a>
            <div className="tiny muted">
              One zip file (slay-backup-date.zip) with all the data <strong>and every product and bill photo</strong> – it contains everyone’s customer details, so
              keep it private.
            </div>
          </section>

          <RestoreSection />
        </main>
      )}
    </>
  );
}

type Step = { kind: 'idle' } | { kind: 'checking' } | { kind: 'checked'; token: string; summary: RestoreSummary; fileName: string } | { kind: 'restoring' } | { kind: 'manual' };

/**
 * Bring data back from a backup file (owners only). First Slay only checks the file and shows
 * what's inside; nothing changes until the owner confirms. The data it replaces is kept on the server.
 */
function RestoreSection() {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [sure, setSure] = useState(false);

  async function check(file: File) {
    setError(null);
    setSure(false);
    setStep({ kind: 'checking' });
    try {
      const r = await api.post<{ token: string; summary: RestoreSummary }>('/api/backups/restore/check', file);
      setStep({ kind: 'checked', ...r, fileName: file.name });
    } catch (e) {
      setError((e as Error).message);
      setStep({ kind: 'idle' });
    }
  }

  async function apply(token: string) {
    setError(null);
    setStep({ kind: 'restoring' });
    try {
      const r = await api.post<{ restarting: boolean }>('/api/backups/restore/apply', { token });
      if (!r.restarting) return setStep({ kind: 'manual' });
      // Slay restarts with the backup swapped in: wait for it, then start again from the sign-in screen.
      await new Promise((ok) => setTimeout(ok, 4000));
      for (let i = 0; i < 90; i++) {
        try {
          const res = await fetch('/api/health', { cache: 'no-store' });
          if (res.ok) break;
        } catch {}
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      await clearSavedQueries(); // the saved screens belong to the data that was replaced
      location.replace('/');
    } catch (e) {
      setError((e as Error).message);
      setStep({ kind: 'idle' });
    }
  }

  return (
    <section className="card stack" style={{ gap: 8 }}>
      <h2>Restore from a backup file</h2>
      <div className="small muted">
        Brings back the data and photos from a backup you saved (slay-backup-….zip from this page or the daily email; older .db.gz files work too, without
        photos). Slay first checks the file and shows what’s inside – nothing changes until you confirm. Photos already on the server are kept.
      </div>

      {(step.kind === 'idle' || step.kind === 'checking') && (
        <label className="btn block" aria-disabled={step.kind === 'checking'}>
          <Icon name="download" size={18} /> {step.kind === 'checking' ? 'Checking the file…' : 'Choose a backup file'}
          <input
            type="file"
            className="file-picker"
            disabled={step.kind === 'checking'}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void check(f);
            }}
          />
        </label>
      )}

      {step.kind === 'checked' && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="restore-preview" role="status">
            <div className="strong small">{step.fileName} – a Slay backup containing:</div>
            <div className="restore-counts">
              <span>
                <b>{step.summary.orders}</b> orders{step.summary.cancelled ? ` (${step.summary.cancelled} cancelled)` : ''}
              </span>
              <span>
                <b>{step.summary.customers}</b> customers
              </span>
              <span>
                <b>{step.summary.products}</b> products
              </span>
              <span>
                <b>{step.summary.bills}</b> bills
              </span>
              <span>
                <b>{step.summary.photos}</b> photos
              </span>
              <span>
                <b>{step.summary.accounts}</b> accounts
              </span>
            </div>
            <div className="tiny muted">
              {step.summary.lastOrderDate ? `Last order ${shortDate(step.summary.lastOrderDate)}` : 'No orders yet'}
              {step.summary.lastChange ? ` · last change ${dateTime(step.summary.lastChange)}` : ''}
              {step.summary.owners.length ? ` · owners: ${step.summary.owners.map((o) => `${o.name} (${o.email})`).join(', ')}` : ''}
            </div>
          </div>
          <div className="alert-banner warning">
            <span>
              Restoring <strong>replaces everything in Slay now</strong> with this backup (the current data is kept on the server as a safety copy). Slay
              restarts for a moment, and everyone signs in again with their accounts from the backup.
            </span>
          </div>
          <Toggle label="I want to restore this backup" sub="Anything added after this backup was made will be replaced." on={sure} onChange={setSure} />
          <button type="button" className="btn primary block" disabled={!sure} onClick={() => apply(step.token)}>
            Restore this backup
          </button>
          <button type="button" className="btn ghost block" onClick={() => setStep({ kind: 'idle' })}>
            Choose a different file
          </button>
        </div>
      )}

      {step.kind === 'restoring' && (
        <div className="stack center" role="status" style={{ gap: 6 }}>
          <div className="spinner" />
          <div className="strong">Restoring… Slay is restarting</div>
          <div className="small muted">This takes up to a minute. Keep this screen open – it continues by itself.</div>
        </div>
      )}

      {step.kind === 'manual' && (
        <div className="alert-banner info">
          <span>The backup is ready. Restart Slay on the server to finish – it swaps the backup in as it starts.</span>
        </div>
      )}

      {error && (
        <div className="small" role="alert" style={{ color: 'var(--bad)' }}>
          {error}
        </div>
      )}
    </section>
  );
}

/** How full the server's disk is, and what takes the space. */
function DiskCard({ d }: { d: BackupInfo['disk'] }) {
  if (d.total === null || d.usedPct === null) return null;
  const used = d.total - (d.free ?? 0);
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <h2>Server disk</h2>
        <span className={`badge ${d.usedPct >= 90 ? 'bad' : d.warn ? 'warn' : 'good'}`}>{d.usedPct}% used</span>
      </div>
      <div className="meter" role="img" aria-label={`${d.usedPct}% of the disk used`}>
        <div style={{ width: `${Math.min(100, d.usedPct)}%`, background: d.usedPct >= 90 ? 'var(--bad)' : d.warn ? 'var(--warn)' : undefined }} />
      </div>
      <div className="small">
        {bytes(used)} of {bytes(d.total)} used · photos {bytes(d.photos)} · daily copies {bytes(d.backups)} · data {bytes(d.database)}
      </div>
      {d.warn && (
        <div className="alert-banner warning" role="alert">
          <span>
            <strong>The disk is getting full.</strong> Make it bigger before it runs out: Render → your Slay service → <strong>Disks</strong> → change the size
            (data and photos are kept). Then save a backup here.
          </span>
        </div>
      )}
    </section>
  );
}
