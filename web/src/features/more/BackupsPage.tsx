import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Icon } from '../../components/Icon';
import { Loading, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { useAuth } from '../../lib/auth';

export interface BackupInfo {
  keepDays: number;
  backups: { name: string; day: string; size: number; createdAt: string }[];
  lastDownload: { at: string; by: string } | null;
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

          <section className="card stack" style={{ gap: 6 }}>
            <h2>If you ever need to bring data back</h2>
            <div className="small muted">
              Send the backup file to whoever looks after the server. They put it in the server’s <code>restore</code> folder and restart Slay; the data from that
              backup comes back, and the data it replaces is kept too, just in case. (Steps: docs/BACKUPS.md.)
            </div>
          </section>
        </main>
      )}
    </>
  );
}
