import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Spinner, TopBar } from '../../components/ui';
import { api } from '../../lib/api';
import { pushState, type PushState } from '../../lib/push';
import { isStandalone } from '../../lib/pwa';

interface Status {
  appUrl: string;
  https: boolean;
  sms: { provider: 'log' | 'sparrow' | 'twilio'; configured: boolean; from: string };
  email: { configured: boolean };
  push: { phones: number };
  esewa: 'test' | 'production';
  voiceServer: boolean;
  myPhone: string | null;
}

type Result = { ok: boolean; text: string; at: string } | null;

/**
 * Owners only: is everything that depends on outside services set up on this server – and does it
 * actually work? Each test sends a real message, so a green result here is a genuine end-to-end check.
 */
export function SetupCheckPage() {
  const q = useQuery({ queryKey: ['system-status'], queryFn: () => api.get<Status>('/api/system/status') });
  const [phone, setPhone] = useState<PushState | null>(null);
  useEffect(() => {
    pushState().then(setPhone);
  }, []);
  const s = q.data;
  return (
    <>
      <TopBar title="Setup check" back="/more" />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <div className="small muted">
          Each test below sends a real message through the real service. A green result means it arrived end to end. Check it on the phone too.
        </div>
        {!s ? (
          <Spinner />
        ) : (
          <>
            <Item
              title="Secure web address (https)"
              ok={s.https}
              status={s.https ? 'Set up' : 'Not yet'}
              detail={
                s.https
                  ? `Slay runs at ${s.appUrl}. Phone notifications, fingerprint / face sign-in and installing to the home screen need this.`
                  : `APP_URL is ${s.appUrl}. Deploy Slay to an https:// address (on Render it's picked up automatically; elsewhere set APP_URL to it), or phone notifications, fingerprint sign-in and installing won't work.`
              }
            />
            <SmsTest s={s} />
            <EmailTest configured={s.email.configured} />
            <PushTest state={phone} phones={s.push.phones} https={s.https} />
            <Item
              title="Installed on this phone"
              ok={isStandalone()}
              status={isStandalone() ? 'Yes' : 'No'}
              detail={isStandalone() ? 'You opened Slay from the home screen.' : 'You opened Slay in the browser. Install it (More → Install the Slay app) and open it from the home screen to check this.'}
            />
            <Item
              title="Nepali voice on iPhone"
              ok={s.voiceServer}
              status={s.voiceServer ? 'Set up' : 'Optional'}
              detail={
                s.voiceServer
                  ? 'Speech is turned into text on the server, so Nepali voice entry works on iPhones too.'
                  : 'Android (Chrome) understands Nepali speech itself. iPhones need TRANSCRIBE_API_KEY on the server for Nepali; English works without it.'
              }
            />
            <Item
              title="eSewa"
              ok={s.esewa === 'production'}
              status={s.esewa === 'production' ? 'Live' : 'Test mode'}
              detail={s.esewa === 'production' ? 'Payment links take real money.' : 'Payment links use eSewa’s test system – no real money moves. Set ESEWA_MODE=production with your merchant details to go live.'}
            />
          </>
        )}
      </main>
    </>
  );
}

function Item({ title, ok, status, detail, children }: { title: string; ok: boolean; status: string; detail: string; children?: ReactNode }) {
  return (
    <section className="card stack" style={{ gap: 8 }}>
      <div className="row between">
        <h2>{title}</h2>
        <span className={`badge ${ok ? 'good' : 'warn'}`}>{status}</span>
      </div>
      <div className="small muted">{detail}</div>
      {children}
    </section>
  );
}

function ResultLine({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <div className={`alert-banner ${r.ok ? 'info' : ''}`} role="status" style={r.ok ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
      <span>
        {r.text} <span className="tiny">({r.at})</span>
      </span>
    </div>
  );
}

function useTest() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setResult(null);
    const at = new Date().toLocaleTimeString();
    try {
      setResult({ ok: true, text: await fn(), at });
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message, at });
    } finally {
      setBusy(false);
    }
  };
  return { busy, result, run };
}

function SmsTest({ s }: { s: Status }) {
  const [to, setTo] = useState(s.myPhone ?? '');
  const t = useTest();
  const provider = s.sms.provider === 'sparrow' ? 'Sparrow SMS' : s.sms.provider === 'twilio' ? 'Twilio' : '';
  return (
    <Item
      title="Text messages (SMS)"
      ok={s.sms.configured}
      status={s.sms.configured ? provider : 'Not yet'}
      detail={
        s.sms.configured
          ? `Sending as “${s.sms.from}”. Used for confirming phone numbers and “Forgot password?” codes.`
          : 'No SMS service is connected, so phone numbers aren’t confirmed and “Forgot password?” can’t send codes. Set SMS_PROVIDER=sparrow with SPARROW_SMS_TOKEN and SPARROW_SMS_FROM on the server.'
      }
    >
      {s.sms.configured && (
        <>
          <label className="field">
            Send a test text to
            <input className="input num" type="tel" inputMode="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="98XXXXXXXX" />
          </label>
          <button
            className="btn primary block"
            disabled={t.busy || !to.trim()}
            onClick={() =>
              t.run(async () => {
                const r = await api.post<{ to: string }>('/api/system/test-sms', { to });
                return `${provider} accepted the message for ${r.to}. Check that phone – it should arrive within a minute.`;
              })
            }
          >
            {t.busy ? 'Sending…' : 'Send test SMS'}
          </button>
          <ResultLine r={t.result} />
        </>
      )}
    </Item>
  );
}

function EmailTest({ configured }: { configured: boolean }) {
  const t = useTest();
  return (
    <Item
      title="Email"
      ok={configured}
      status={configured ? 'Set up' : 'Optional'}
      detail={configured ? 'Security notifications are also emailed.' : 'Optional: set SMTP_URL and MAIL_FROM on the server to also email security notifications.'}
    >
      {configured && (
        <>
          <button className="btn block" disabled={t.busy} onClick={() => t.run(async () => `Sent to ${(await api.post<{ to: string }>('/api/system/test-email')).to} – check the inbox (and spam folder).`)}>
            {t.busy ? 'Sending…' : 'Send test email'}
          </button>
          <ResultLine r={t.result} />
        </>
      )}
    </Item>
  );
}

function PushTest({ state, phones, https }: { state: PushState | null; phones: number; https: boolean }) {
  const t = useTest();
  const on = state === 'on';
  return (
    <Item
      title="Phone notifications"
      ok={on}
      status={on ? 'On for this phone' : 'Not on this phone'}
      detail={
        on
          ? `This phone is set up${phones > 1 ? ` (and ${phones - 1} more of your devices)` : ''}. Close Slay before testing, to check that notifications arrive while it's closed.`
          : !https
            ? 'Needs the secure https address first.'
            : state === 'needs-install'
              ? 'On iPhone, install Slay to the home screen first, then turn notifications on.'
              : 'Turn them on for this phone under More → Notifications.'
      }
    >
      {on ? (
        <>
          <button
            className="btn block"
            disabled={t.busy}
            onClick={() =>
              t.run(async () => {
                // A short delay so there's time to close Slay / lock the phone first.
                await new Promise((r) => setTimeout(r, 10_000));
                const { sent } = await api.post<{ sent: number }>('/api/security/push/test');
                if (!sent) throw new Error('No phone could be reached. Turn notifications off and on again under More → Notifications.');
                return `Sent to ${sent} device${sent > 1 ? 's' : ''}.`;
              })
            }
          >
            {t.busy ? 'Sending in 10 seconds – close Slay or lock the phone now…' : 'Send test notification (in 10 seconds)'}
          </button>
          <ResultLine r={t.result} />
        </>
      ) : (
        <Link to="/more/notifications" className="btn block">
          Notification settings
        </Link>
      )}
    </Item>
  );
}
