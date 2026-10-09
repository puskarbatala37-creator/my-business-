import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { canInstallHere, OPEN_INSTALL } from '../../components/InstallPrompt';
import { Sheet, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ConfirmPhone } from '../auth/CompleteAccountPage';

const LINKS = [
  { to: '/receipts', icon: 'receipt', label: 'Supplier bills', sub: 'Photos of stock & material purchases' },
  { to: '/customers', icon: 'users', label: 'Customers', sub: 'Contacts and order history' },
  { to: '/more/team', icon: 'team', label: 'Team', sub: 'Add team members, reset passwords' },
  { to: '/more/notifications', icon: 'bell', label: 'Notifications', sub: 'Security alerts on your phone and by email – on or off' },
  { to: '/more/security', icon: 'shield', label: 'Security', sub: 'Fingerprint / face sign-in, alerts, devices' },
];

export function MorePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [pw, setPw] = useState(false);
  const [editing, setEditing] = useState<null | 'email' | 'phone' | 'confirm'>(null);
  const user = me?.user;
  const rowStyle = { width: '100%', border: 0, background: 'transparent', textAlign: 'left' as const };
  return (
    <>
      <TopBar title="More" />
      <main className="page stack" style={{ paddingTop: 12 }}>
        {canInstallHere() && (
          <button className="list-item install-row" onClick={() => window.dispatchEvent(new Event(OPEN_INSTALL))}>
            <img src="/icons/icon-96.png" alt="" width={40} height={40} style={{ borderRadius: 10 }} />
            <div className="grow">
              <div className="strong">Install the Slay app</div>
              <div className="small muted">Put Slay on your home screen – opens full screen, works with poor signal</div>
            </div>
            <Icon name="plus" />
          </button>
        )}
        <div className="list">
          {LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="list-item">
              <span className="thumb" style={{ width: 40, height: 40 }}>
                <Icon name={l.icon} />
              </span>
              <div className="grow">
                <div className="strong">{l.label}</div>
                <div className="small muted">{l.sub}</div>
              </div>
            </Link>
          ))}
        </div>
        <div className="section-title" style={{ marginTop: 8 }}>
          <h2>Your account</h2>
        </div>
        <div className="list">
          <div className="list-item">
            <div className="grow">
              <div className="strong">{user?.displayName}</div>
              <div className="small muted">{user?.role === 'owner' ? 'Owner' : 'Team member'}</div>
            </div>
          </div>
          <button className="list-item" style={rowStyle} onClick={() => setEditing('email')}>
            <div className="grow">
              <div className="small muted">Sign-in email · security notifications</div>
              <div className="strong ellipsis">{user?.email}</div>
            </div>
            <span className="small" style={{ color: 'var(--accent)' }}>
              Change
            </span>
          </button>
          <button className="list-item" style={rowStyle} onClick={() => setEditing(user?.phoneVerified || !me?.smsReady ? 'phone' : 'confirm')}>
            <div className="grow">
              <div className="small muted">Mobile number · account recovery codes</div>
              <div className="strong num">{user?.phone}</div>
            </div>
            {user?.phoneVerified ? (
              <span className="badge good">Confirmed</span>
            ) : me?.smsReady ? (
              <span className="badge warn">Confirm</span>
            ) : (
              <span className="small" style={{ color: 'var(--accent)' }}>
                Change
              </span>
            )}
          </button>
          <button className="list-item" style={rowStyle} onClick={() => setPw(true)}>
            <div className="grow strong">Change password</div>
          </button>
          <button
            className="list-item"
            style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left', color: 'var(--bad)' }}
            onClick={async () => {
              await api.post('/api/auth/logout').catch(() => {});
              nav('/', { replace: true }); // the next sign-in starts on Home
              qc.setQueryData(['me'], null);
              qc.clear();
            }}
          >
            <Icon name="logout" /> <span className="strong">Sign out</span>
          </button>
        </div>
      </main>
      {pw && <PasswordSheet onClose={() => setPw(false)} />}
      {(editing === 'email' || editing === 'phone') && user && (
        <AccountSheet field={editing} current={(editing === 'email' ? user.email : user.phone) ?? ''} onClose={() => setEditing(null)} />
      )}
      {editing === 'confirm' && user?.phone && (
        <Sheet title="Confirm your phone number" onClose={() => setEditing(null)}>
          <ConfirmPhone
            phone={user.phone}
            onConfirmed={() => {
              qc.invalidateQueries({ queryKey: ['me'] });
              setEditing(null);
            }}
          />
          <button type="button" className="btn ghost block mt" onClick={() => setEditing('phone')}>
            Use a different number
          </button>
        </Sheet>
      )}
    </>
  );
}

/** Change your own sign-in email or recovery phone. The whole team is notified, since these control access. */
function AccountSheet({ field, current, onClose }: { field: 'email' | 'phone'; current: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={field === 'email' ? 'Sign-in email' : 'Mobile number'} onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.patch('/api/auth/profile', { [field]: value });
            await qc.invalidateQueries({ queryKey: ['me'] });
            toast(field === 'email' ? 'Saved – sign in with your new email from now on' : 'Saved');
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {field === 'email' ? (
          <label className="field">
            Email
            <input className="input" type="email" inputMode="email" autoCapitalize="none" autoComplete="email" value={value} onChange={(e) => setValue(e.target.value)} required />
          </label>
        ) : (
          <label className="field">
            Mobile number
            <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="98XXXXXXXX" value={value} onChange={(e) => setValue(e.target.value)} required />
          </label>
        )}
        <div className="tiny muted">
          {field === 'email'
            ? 'You sign in with this email, and security notifications are sent to it.'
            : 'If you ever can’t get into your account, a recovery code is texted to this number. A new number needs confirming with a code.'}{' '}
          Your team is notified of the change.
        </div>
        <button className="btn primary block" disabled={busy || !value.trim() || value.trim() === current}>
          Save
        </button>
      </form>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  return (
    <Sheet title="Change password" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/auth/password', { current, next });
            toast('Password changed. Your other devices were signed out.');
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          }
        }}
      >
        <label className="field">
          Current password
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="field">
          New password (at least 8 characters)
          <input className="input" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </label>
        <button className="btn primary block">Change password</button>
      </form>
    </Sheet>
  );
}
