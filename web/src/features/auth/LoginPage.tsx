import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { biometricAvailable, biometricEnrolledHere, biometricLogin, biometricName } from '../../lib/biometric';

export const JUST_USED_PASSWORD = 'slay.passwordLogin';

/**
 * Sign-in. On a phone with a fingerprint / face sensor that has been set up,
 * biometric sign-in is the main button; username + password is the fallback.
 */
export function LoginPage() {
  const qc = useQueryClient();
  const setup = useQuery({ queryKey: ['setup'], queryFn: () => api.get<{ needsSetup: boolean }>('/api/auth/setup') });
  const [bio, setBio] = useState<boolean | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState('');
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

  const passwordForm = !bio || showPassword;

  return (
    <div className="login-wrap">
      <div className="card stack" style={{ width: '100%', maxWidth: 380, padding: 24 }}>
        <div className="center">
          <div className="brand">Slay</div>
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
        {import.meta.env.VITE_DEMO === '1' && (
          <div className="alert-banner info small">
            <div>
              Demo logins: <strong>teza</strong> / <strong>demo-teza-123</strong> or <strong>partner</strong> / <strong>demo-partner-123</strong>
              <button
                type="button"
                className="btn sm block"
                style={{ marginTop: 8 }}
                onClick={() => {
                  setUsername('teza');
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
                await api.post('/api/auth/login', { username, password });
                try {
                  sessionStorage.setItem(JUST_USED_PASSWORD, '1');
                } catch {}
                await signedIn();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              Username
              <input className="input" autoComplete="username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required />
            </label>
            <label className="field">
              Password
              <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className={`btn block ${bio ? '' : 'primary'}`} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with password'}
            </button>
          </form>
        ) : (
          <button className="btn ghost block" onClick={() => setShowPassword(true)}>
            Use username &amp; password instead
          </button>
        )}
      </div>
    </div>
  );
}

/** First start: create the first owner account in the app (setup code is in the server log). */
function SetupPage({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ code: '', displayName: '', username: '', password: '' });
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
          <div className="brand">Slay</div>
          <div className="small muted">Welcome! Create the first owner account. You can add the rest of the team from the app afterwards.</div>
        </div>
        {field('code', 'Setup code (shown in the server log)', { inputMode: 'numeric', autoComplete: 'one-time-code' })}
        {field('displayName', 'Your name')}
        {field('username', 'Username', { autoCapitalize: 'none', autoComplete: 'username' })}
        {field('password', 'Password (at least 8 characters)', { type: 'password', minLength: 8, autoComplete: 'new-password' })}
        {error && <div className="alert-banner">{error}</div>}
        <button className="btn primary block" disabled={busy}>
          Create account
        </button>
      </form>
    </div>
  );
}
