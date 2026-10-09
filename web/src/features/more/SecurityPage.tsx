import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Empty, Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { biometricAvailable, biometricEnrolledHere, biometricName, enrollBiometric, forgetBiometricHere } from '../../lib/biometric';
import type { Alert } from '../../lib/types';
import { NotificationSettings } from './NotificationsPage';

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
  const devices = useQuery({
    queryKey: ['trusted-devices'],
    queryFn: () => api.get<{ devices: { user_id: number; device_id: string; label: string; first_seen: string; last_seen_at: string | null; user_name: string; current: boolean }[] }>('/api/security/devices'),
  });
  const notifications = (alerts.data?.alerts ?? []).filter((a) => a.severity !== 'info');
  const activity = (alerts.data?.alerts ?? []).filter((a) => a.severity === 'info');
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: () => api.get<{ passkeys: { id: number; label: string; created_at: string; last_used_at: string | null }[] }>('/api/auth/passkeys') });
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioHere, setBioHere] = useState(biometricEnrolledHere());
  useEffect(() => {
    biometricAvailable().then(setBioAvailable);
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
          <h2>Fingerprint / face sign-in</h2>
          <div className="small muted">Sign in with {biometricName} instead of typing your password. Your password still works as a backup.</div>
          {bioAvailable ? (
            bioHere ? (
              <div className="badge good">On for this phone</div>
            ) : (
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await enrollBiometric();
                    setBioHere(true);
                    passkeys.refetch();
                    toast(`${biometricName} sign-in is on`);
                  } catch (e) {
                    toast((e as Error).message, true);
                  }
                }}
              >
                Turn on {biometricName}
              </button>
            )
          ) : (
            <div className="small">This device has no fingerprint or face sensor the browser can use (or it isn’t set up in the phone’s settings).</div>
          )}
          {!!passkeys.data?.passkeys.length && (
            <div className="list">
              {passkeys.data.passkeys.map((k) => (
                <div key={k.id} className="list-item">
                  <div className="grow">
                    <div className="strong small">{k.label || 'Device'}</div>
                    <div className="tiny muted">
                      Added {dateTime(k.created_at)}
                      {k.last_used_at && ` · last used ${dateTime(k.last_used_at)}`}
                    </div>
                  </div>
                  <button
                    className="btn sm danger"
                    onClick={async () => {
                      if (!confirm('Remove fingerprint / face sign-in for this device?')) return;
                      await api.del(`/api/auth/passkeys/${k.id}`);
                      if (passkeys.data!.passkeys.length === 1) {
                        forgetBiometricHere();
                        setBioHere(false);
                      }
                      passkeys.refetch();
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <NotificationSettings />

        <div className="section-title">
          <h2>Security notifications</h2>
        </div>
        <div className="tiny muted" style={{ marginTop: -4 }}>
          Sent when a device signs in for the first time, or when something looks suspicious (wrong passwords, lockouts, unusual activity). Sign-ins from trusted devices are not notified.
        </div>
        {alerts.isLoading ? (
          <Spinner />
        ) : !notifications.length ? (
          <Empty>Nothing suspicious – all quiet.</Empty>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {notifications.map((a) => (
              <div key={a.id} className={`alert-banner ${a.severity === 'critical' ? '' : a.severity}`}>
                <div className="grow">
                  <div className="strong small">{a.severity === 'critical' ? 'Critical' : 'Warning'}</div>
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
          <h2>Trusted devices</h2>
        </div>
        <div className="tiny muted" style={{ marginTop: -4 }}>
          Devices that have signed in before. Remove one you don’t recognise or no longer use – it is signed out, and its next sign-in will notify everyone again.
        </div>
        <div className="list">
          {devices.data?.devices.map((d) => (
            <div key={d.user_id + d.device_id} className="list-item">
              <div className="grow">
                <div className="strong">
                  {d.user_name} · {d.label || 'Device'}
                </div>
                <div className="tiny muted">
                  {d.current ? 'This device' : `Trusted since ${dateTime(d.first_seen)}`}
                  {!d.current && d.last_seen_at && ` · last active ${dateTime(d.last_seen_at)}`}
                </div>
              </div>
              {!d.current && (
                <button
                  className="btn sm danger"
                  onClick={async () => {
                    if (!confirm(`Remove ${d.user_name}'s ${d.label} from trusted devices? It will be signed out.`)) return;
                    await api.post('/api/security/devices/forget', { user_id: d.user_id, device_id: d.device_id });
                    devices.refetch();
                    sessions.refetch();
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

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

        {activity.length > 0 && (
          <details className="card">
            <summary className="strong small" style={{ cursor: 'pointer' }}>
              Activity log ({activity.length})
            </summary>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {activity.map((a) => (
                <div key={a.id} className="small">
                  {a.message} <span className="tiny muted">· {dateTime(a.created_at)}</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </main>
    </>
  );
}
