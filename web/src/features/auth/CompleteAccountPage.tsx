import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CodeInput, DemoCode } from '../../components/CodeInput';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import type { Profile } from '../../lib/types';

/** Sends a code to the account's phone and checks it. Used here and under More → Account. */
export function ConfirmPhone({ phone, onConfirmed }: { phone: string; onConfirmed: () => void }) {
  const [sent, setSent] = useState<{ to: string; demo_code?: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setError('');
    try {
      setSent(await api.post<{ to: string; demo_code?: string }>('/api/auth/profile/phone/send-code'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      {!sent ? (
        <>
          <div className="small">
            We'll text a 6-digit code to <strong className="num">{phone}</strong> to make sure texts reach you.
          </div>
          {error && <div className="alert-banner">{error}</div>}
          <button type="button" className="btn primary block" onClick={send} disabled={busy}>
            {busy ? 'Sending…' : 'Text me a code'}
          </button>
        </>
      ) : (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              await api.post('/api/auth/profile/phone/verify', { code });
              onConfirmed();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="small">Code sent to {sent.to}.</div>
          <DemoCode code={sent.demo_code} />
          <CodeInput id="confirm-code" value={code} onChange={setCode} />
          {error && <div className="alert-banner">{error}</div>}
          <button className="btn primary block" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Confirm phone number'}
          </button>
          <button type="button" className="btn ghost block" onClick={send} disabled={busy}>
            Send a new code
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * Shown after sign-in until the account has a sign-in email (older accounts that signed in with a
 * username). A phone number is optional.
 */
export function CompleteAccountPage({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const { refresh } = useAuth();
  const needsDetails = profile.missing.includes('email') || profile.missing.includes('phone');
  const [email, setEmail] = useState(profile.email ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-wrap">
      <div className="card stack" style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <div>
          <h1>Finish setting up your account</h1>
          <div className="small muted" style={{ marginTop: 4 }}>
            Hi {profile.displayName}! {needsDetails ? 'Two quick details and you’re in.' : 'One last step.'}
          </div>
        </div>
        {needsDetails ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api.patch('/api/auth/profile', {
                  ...(profile.missing.includes('email') ? { email } : {}),
                  ...(profile.missing.includes('phone') ? { phone } : {}),
                });
                refresh();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {profile.missing.includes('email') && (
              <label className="field">
                Your email – from now on you sign in with this
                <input className="input" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
            )}
            {profile.missing.includes('phone') && (
              <label className="field">
                Your mobile number – if you ever can't get into your account, we text a recovery code here
                <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX or +61…" value={phone} onChange={(e) => setPhone(e.target.value)} required />
              </label>
            )}
            {error && <div className="alert-banner">{error}</div>}
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Saving…' : 'Continue'}
            </button>
          </form>
        ) : (
          <ConfirmPhone phone={profile.phone ?? ''} onConfirmed={refresh} />
        )}
        <button
          type="button"
          className="btn ghost block"
          onClick={async () => {
            await api.post('/api/auth/logout').catch(() => {});
            qc.setQueryData(['me'], null);
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
