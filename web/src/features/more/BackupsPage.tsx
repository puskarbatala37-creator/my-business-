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
  backups: { name: string; day: string; size: number; createdAt: string }[];
  lastDownload: { at: string; by: string } | null;
  email: { configured: boolean; last: { day: string; at: string; ok: boolean; to?: string[]; error?: string } | null };
}

interface RestoreSummary {
  accounts: number;
  orders: number;
  cancelled: number;
  customers: number;
  products: number;
  bills: number;
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
          <section className="card stack" style={{ gap: 8 }}>
            <div className="row between">
              <h2>Automatic copies on the server</h2>
              <span className={`badge ${latest ? 'good' : 'warn'}`}>{latest ? 'On' : 'Starting'}</span>
            </div>
            <div className="small muted">
              Every day Slay copies all orders, customers, payments, stock, supplier bills and accounts, and keeps the last {b.keepDays} days. If something is
              deleted by mistake or goes wrong, it can be brought back from one of these.
            </div>
            {latest ? (
              <div className="small">
                Latest copy: <strong>{dateTime(latest.createdAt)}</strong> · {b.backups.length} kept
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
            <div className="small muted">After each daily copy, Slay emails it to every owner’s email address – a copy off the server, automatically.</div>
            {!b.email.configured ? (
              <div className="small">Email isn’t set up on the server yet (SMTP_URL – see DEPLOY.md, Part 3). Until then, save a copy below once a week.</div>
            ) : b.email.last?.ok ? (
              <div className="small">
                Last emailed {dateTime(b.email.last.at)} to {b.email.last.to?.join(', ')}.
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
              It’s one small file (slay-backup-date.db.gz) containing everyone’s customer details – keep it private. Product and bill photos aren’t inside it.
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
        Brings back the data from a backup you saved (slay-backup-….db.gz, from this page or the daily email). Slay first checks the file and shows what’s
        inside – nothing changes until you confirm.
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
