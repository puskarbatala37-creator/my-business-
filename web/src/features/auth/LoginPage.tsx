import { BrandMark } from '../../components/BrandMark';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CodeInput, DemoCode } from '../../components/CodeInput';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { biometricAvailable, biometricEnrolledHere, biometricLogin, biometricName } from '../../lib/biometric';

export const JUST_USED_PASSWORD = 'slay.passwordLogin';
const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const markPasswordLogin = () => {
  try {
    sessionStorage.setItem(JUST_USED_PASSWORD, '1');
  } catch {}
};

/**
 * Sign-in. On a phone with a fingerprint / face sensor that has been set up,
 * biometric sign-in is the main button; email + password is the fallback,
 * and "Forgot password?" emails a recovery code (or texts it when the server has no email set up).
 */
export function LoginPage() {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/auth/setup') });
  const [bio, setBio] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [signingUp, setSigningUp] = useState(false);
  const signupMode = useQuery({ queryKey: ['signup-mode'], queryFn: () => api.get<{ mode: 'approval' | 'open' | 'closed' }>('/api/auth/signup') });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    biometricAvailable().then((ok) => setBio(ok && biometricEnrolledHere()));
  }, []);

  const signedIn = () => qc.invalidateQueries({ queryKey: ['me'] });

  async function withBiometric() {
    setBusy(true);
    setError('');
    try {
      await biometricLogin();
      await signedIn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (setup.isLoading || bio === null) return <Spinner />;
  if (setup.data?.needsSetup) return <SetupPage onDone={signedIn} />;
  if (recovering) return <RecoverPage initialEmail={email} onDone={signedIn} onCancel={() => setRecovering(false)} />;
  if (signingUp) return <SignupPage mode={signupMode.data?.mode ?? 'approval'} onDone={signedIn} onCancel={() => setSigningUp(false)} />;

  const passwordForm = !bio || showPassword;

  return (
    <div className="login-wrap">
      <div className="card stack" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <div className="center">
          <div className="brand"><BrandMark width={128} /></div>
          <div className="muted small">Orders &amp; stock</div>
        </div>

        {bio && (
          <button className="btn primary block" style={{ minHeight: 60, fontSize: 17 }} onClick={withBiometric} disabled={busy}>
            <Icon name="fingerprint" size={26} /> {busy ? 'Waiting…' : `Sign in with ${biometricName}`}
          </button>
        )}
        {error && (
          <div className="alert-banner" role="alert">
            {error}
          </div>
        )}
        {IS_DEMO && (
          <div className="alert-banner info small">
            <div>
              Demo logins: <strong>teza@slay.demo</strong> / <strong>demo-teza-123</strong> or <strong>partner@slay.demo</strong> / <strong>demo-partner-123</strong>
              <button
                type="button"
                className="btn sm block"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setEmail('teza@slay.demo');
                  setPassword('demo-teza-123');
                }}
              >
                Fill in Teza's demo login
              </button>
            </div>
          </div>
        )}

        {passwordForm ? (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api.post('/api/auth/login', { email, password });
                markPasswordLogin();
                await signedIn();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Email
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              Password
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className={`btn block ${bio ? '' : 'primary'}`} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with password'}
            </button>
            <button type="button" className="btn ghost block" onClick={() => setRecovering(true)}>
              Forgot password?
            </button>
          </form>
        ) : (
          <button className="btn ghost block" onClick={() => setShowPassword(true)}>
            Use email &amp; password instead
          </button>
        )}

        <div className="hr" />
        {signupMode.data?.mode === 'closed' ? (
          <div className="tiny muted center">New to the team? Ask an owner to add you under More → Team.</div>
        ) : (
          <button type="button" className="btn block" onClick={() => setSigningUp(true)}>
            New here? Create an account
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Create your own account. Depending on the owners' setting you're in straight away,
 * or an owner approves you first.
 */
function SignupPage({ mode, onDone, onCancel }: { mode: 'approval' | 'open' | 'closed'; onDone: () => void; onCancel: () => void }) {
  const [f, setF] = useState({ displayName: '', email: '', phone: '', password: '' });
  const [waiting, setWaiting] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <label className="field">
      {label}
      <input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required {...props} />
    </label>
  );

  if (waiting) {
    return (
      <div className="login-wrap">
        <div className="card stack center" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
          <div className="brand"><BrandMark width={128} /></div>
          <h1>Almost there</h1>
          <div>{waiting}</div>
          <div className="small muted">
            Your account: <strong>{f.email.trim().toLowerCase()}</strong>
          </div>
          <button type="button" className="btn primary block" onClick={onCancel}>
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form
        className="card stack"
        style={{ width: '100%', maxWidth: 380, padding: 24 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const r = await api.post<{ pending?: boolean; message?: string }>('/api/auth/signup', f);
            if (r.pending) setWaiting(r.message ?? 'An owner needs to approve your account.');
            else {
              markPasswordLogin();
              onDone();
            }
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h1>Create your account</h1>
          <div className="small muted" style={{ marginTop: 4 }}>
            {mode === 'open' ? 'You can start using Slay as soon as you sign up.' : 'An owner approves new accounts. You can sign in as soon as they do.'}
            {IS_DEMO && ' (Demo preview: in the real app, owners choose whether new accounts need their approval.)'}
          </div>
        </div>
        {field('displayName', 'Your name', { autoComplete: 'name' })}
        {field('email', 'Email – you sign in with this', { type: 'email', inputMode: 'email', autoCapitalize: 'none', autoComplete: 'email', spellCheck: false })}
        {field('phone', 'Mobile number (optional)', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '98XXXXXXXX or +61…', required: false })}
        <div className="tiny muted" style={{ marginTop: -6 }}>
          You can leave this empty – codes to reset your password come to your email. Nepal: 98XXXXXXXX · other countries: + and country code, e.g. +61412345678
        </div>
        {field('password', 'Password (at least 8 characters)', { type: 'password', minLength: 8, autoComplete: 'new-password' })}
        {error && (
          <div className="alert-banner" role="alert">
            {error}
          </div>
        )}
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <button type="button" className="btn ghost block" onClick={onCancel}>
          I already have an account
        </button>
      </form>
    </div>
  );
}

/** "Forgot password?": a 6-digit code goes to the account's email (or by SMS if the server has no email set up). */
function RecoverPage({ initialEmail, onDone, onCancel }: { initialEmail: string; onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [demoCode, setDemoCode] = useState<string>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post<{ message: string; demo_code?: string }>('/api/auth/recover', { email });
      setMessage(r.message);
      setDemoCode(r.demo_code);
      setStep('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="card stack" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <h1>Reset your password</h1>
        {step === 'email' ? (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="small muted">We'll send a 6-digit code to the email address of your account.</div>
            <label className="field">
              Your sign-in email
              <input className="input" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            {error && <div className="alert-banner">{error}</div>}
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        ) : (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api.post('/api/auth/recover/reset', { email, code, password });
                markPasswordLogin();
                onDone();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="small">{message}</div>
            <DemoCode code={demoCode} />
            <label className="field" htmlFor="recover-code">
              6-digit code
              <CodeInput id="recover-code" value={code} onChange={setCode} />
            </label>
            <label className="field">
              New password (at least 8 characters)
              <input className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            {error && <div className="alert-banner">{error}</div>}
            <button className="btn primary block" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Set new password & sign in'}
            </button>
            <button type="button" className="btn ghost block" onClick={() => void send()} disabled={busy}>
              Send a new code
            </button>
          </form>
        )}
        <button type="button" className="btn ghost block" onClick={onCancel}>
          Back to sign in
        </button>
        <div className="tiny muted center">No code arriving, or can't get into that email? Ask an owner to reset your password under More → Team.</div>
      </div>
    </div>
  );
}

/** First start: create the first owner account in the app (setup code is in the server log). */
function SetupPage({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ code: '', displayName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <label className="field">
      {label}
      <input className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required {...props} />
    </label>
  );
  return (
    <div className="login-wrap">
      <form
        className="card stack"
        style={{ width: '100%', maxWidth: 380, padding: 24 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api.post('/api/auth/setup', f);
            onDone();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="center">
          <div className="brand"><BrandMark width={128} /></div>
          <div className="small muted">Welcome! Create the first owner account. You can add the rest of the team from the app afterwards.</div>
        </div>
        {field('code', 'Setup code (shown in the server log)', { inputMode: 'numeric', autoComplete: 'off' })}
        {field('displayName', 'Your name', { autoComplete: 'name' })}
        {field('email', 'Email – you sign in with this', { type: 'email', inputMode: 'email', autoCapitalize: 'none', autoComplete: 'email' })}
        {field('phone', 'Mobile number (optional)', { type: 'tel', inputMode: 'tel', autoComplete: 'tel', placeholder: '98XXXXXXXX or +61…', required: false })}
        <div className="tiny muted" style={{ marginTop: -6 }}>
          You can leave this empty – codes to reset your password come to your email. Nepal: 98XXXXXXXX · other countries: + and country code, e.g. +61412345678
        </div>
        {field('password', 'Password (at least 8 characters)', { type: 'password', minLength: 8, autoComplete: 'new-password' })}
        {error && <div className="alert-banner">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          Create account
        </button>
      </form>
    </div>
  );
}
