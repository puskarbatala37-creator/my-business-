import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Empty, Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { enablePush, pushEnabled, pushSupported } from '../../lib/push';
import type { Alert } from '../../lib/types';

interface SessionRow {
  id: number;
  ip: string;
  user_agent: string;
  created_at: string;
  last_seen_at: string;
  user_name: string;
  current: boolean;
}

const deviceName = (ua: string) =>
  `${/CriOS|Chrome/.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : 'Browser'} on ${/iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device'}`;

export function SecurityPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<{ alerts: Alert[]; unread: number }>('/api/security/alerts') });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ sessions: SessionRow[] }>('/api/security/sessions') });
  const [push, setPush] = useState<boolean | null>(null);

  useEffect(() => {
    pushEnabled().then(setPush);
  }, []);
  // Opening this screen marks alerts as read (for this user only).
  useEffect(() => {
    if (alerts.data?.unread) api.post('/api/security/alerts/read').then(() => qc.invalidateQueries({ queryKey: ['alerts'] }));
  }, [alerts.data?.unread, qc]);

  return (
    <>
      <TopBar title="Security" back="/more" />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <section className="card stack">
          <h2>Phone notifications</h2>
          <div className="small muted">Get a notification on this phone when someone tries to break in or something unusual happens – even when Slay is closed.</div>
          {push ? (
            <div className="badge good">On for this phone</div>
          ) : (
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  await enablePush();
                  setPush(true);
                  toast('Notifications are on');
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              Turn on notifications
            </button>
          )}
        </section>

        <div className="section-title">
          <h2>Alerts</h2>
        </div>
        {alerts.isLoading ? (
          <Spinner />
        ) : !alerts.data?.alerts.length ? (
          <Empty>No alerts – all quiet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {alerts.data.alerts.map((a) => (
              <div key={a.id} className={`alert-banner ${a.severity === 'critical' ? '' : a.severity}`}>
                <div className="grow">
                  <div className="strong small">{a.severity === 'critical' ? 'Critical' : a.severity === 'warning' ? 'Warning' : 'Info'}</div>
                  <div>{a.message}</div>
                  <div className="tiny" style={{ opacity: 0.8, marginTop: 2 }}>
                    {dateTime(a.created_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="section-title">
          <h2>Signed-in devices</h2>
        </div>
        <div className="list">
          {sessions.data?.sessions.map((s) => (
            <div key={s.id} className="list-item">
              <div className="grow">
                <div className="strong">
                  {s.user_name} · {deviceName(s.user_agent)}
                </div>
                <div className="tiny muted">
                  {s.current ? 'This device' : `Last active ${dateTime(s.last_seen_at)}`} · IP {s.ip}
                </div>
              </div>
              {!s.current && (
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm('Sign this device out?')) return;
                    await api.del(`/api/security/sessions/${s.id}`);
                    sessions.refetch();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
