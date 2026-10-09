import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { OPEN_INSTALL } from '../../components/InstallPrompt';
import { Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { BLOCKED_HELP, enablePush, pushState, type NotificationPrefs, type PushState } from '../../lib/push';

export function NotificationsPage() {
  return (
    <>
      <TopBar title="Notifications" back="/more" />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <NotificationSettings />
        <div className="tiny muted">
          Security notifications are sent when a device signs in to Slay for the first time, or when something looks suspicious – repeated wrong
          passwords, a locked account, a switched-off account being used, a paid order cancelled, lots of cancellations, or a large amount of stock
          removed. Everyday sign-ins from trusted phones never notify anyone. Whatever you choose here, every alert is still listed under the bell
          and in More → Security.
        </div>
      </main>
    </>
  );
}

/** Each person's own on/off switches for security notifications, plus this phone's set-up. */
export function NotificationSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: () => api.get<NotificationPrefs>('/api/security/notifications') });
  const [phone, setPhone] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    pushState().then(setPhone);
  }, []);

  const save = async (patch: Partial<Pick<NotificationPrefs, 'push' | 'email'>>) => {
    const next = await api.put<NotificationPrefs>('/api/security/notifications', patch);
    qc.setQueryData(['notification-prefs'], next);
    return next;
  };
  const setUpThisPhone = async () => {
    await enablePush();
    setPhone('on');
    qc.invalidateQueries({ queryKey: ['notification-prefs'] });
  };

  const onSetUp = async () => {
    setBusy(true);
    try {
      await setUpThisPhone();
      toast('This phone will get security notifications');
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const onTest = async () => {
    try {
      const { sent } = await api.post<{ sent: number }>('/api/security/push/test');
      toast(sent ? 'Test sent – it should pop up in a moment' : 'Couldn’t reach this phone – turn notifications off and on again', !sent);
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  if (!prefs.data || phone === null) return <Spinner />;
  const p = prefs.data;

  return (
    <section className="card stack">
      <h2>Security notifications</h2>
      <Toggle
        label="Phone notifications"
        sub={p.push ? 'Pop up on your phone like a text message – even when Slay is closed.' : 'Off – you won’t get security notifications on your phones.'}
        on={p.push}
        busy={busy}
        onChange={async (on) => {
          setBusy(true);
          try {
            await save({ push: on });
            if (on && phone === 'off') await setUpThisPhone();
            toast(on ? 'Phone notifications are on' : 'Phone notifications are off');
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      />
      {p.push && <PhoneStatus state={phone} busy={busy} onSetUp={onSetUp} onTest={onTest} />}
      <div className="hr" />
      <Toggle
        label="Email"
        sub={!p.emailAvailable ? 'Email sending isn’t set up on the server yet, so nothing is emailed for now.' : p.email ? 'A copy of each notification goes to your sign-in email.' : 'Off – no security emails.'}
        on={p.email}
        busy={busy}
        onChange={async (on) => {
          try {
            await save({ email: on });
            toast(on ? 'Security emails are on' : 'Security emails are off');
          } catch (e) {
            toast((e as Error).message, true);
          }
        }}
      />
    </section>
  );
}

function PhoneStatus({ state, busy, onSetUp, onTest }: { state: PushState; busy: boolean; onSetUp: () => void; onTest: () => void }) {
  if (state === 'on')
    return (
      <div className="row between wrap">
        <span className="badge good">On for this phone</span>
        <button type="button" className="btn sm" onClick={onTest}>
          Send a test
        </button>
      </div>
    );
  if (state === 'off')
    return (
      <div className="alert-banner info">
        <div className="grow stack" style={{ gap: 8 }}>
          <span>This phone isn’t set up yet. Your phone will ask to allow notifications from Slay – tap Allow.</span>
          <button type="button" className="btn primary sm" disabled={busy} onClick={onSetUp}>
            Turn on for this phone
          </button>
        </div>
      </div>
    );
  if (state === 'needs-install')
    return (
      <div className="alert-banner info">
        <div className="grow stack" style={{ gap: 8 }}>
          <span>On iPhone, notifications only work once Slay is on your Home Screen. Add it, open Slay from there, and come back here.</span>
          <button type="button" className="btn sm" onClick={() => window.dispatchEvent(new Event(OPEN_INSTALL))}>
            How to add Slay to the Home Screen
          </button>
        </div>
      </div>
    );
  if (state === 'blocked') return <div className="alert-banner warning">{BLOCKED_HELP}</div>;
  if (import.meta.env.VITE_DEMO === '1') return <div className="alert-banner info">Phone notifications work in the real, installed Slay app – not in this preview.</div>;
  return <div className="alert-banner info">This browser can’t show notifications. Use Chrome on Android, or Slay installed on an iPhone (iOS 16.4 or newer).</div>;
}

function Toggle({ label, sub, on, busy, onChange }: { label: string; sub: string; on: boolean; busy?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="toggle-row" disabled={busy} onClick={() => onChange(!on)}>
      <span className="grow">
        <span className="strong" style={{ display: 'block' }}>
          {label}
        </span>
        <span className="small muted">{sub}</span>
      </span>
      <span className={`switch ${on ? 'on' : ''}`} aria-hidden="true" />
    </button>
  );
}
