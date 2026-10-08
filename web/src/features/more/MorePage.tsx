import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Sheet, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const LINKS = [
  { to: '/receipts', icon: 'receipt', label: 'Supplier bills', sub: 'Photos of stock & material purchases' },
  { to: '/customers', icon: 'users', label: 'Customers', sub: 'Contacts and order history' },
  { to: '/more/team', icon: 'team', label: 'Team', sub: 'Add team members, reset passwords' },
  { to: '/more/security', icon: 'shield', label: 'Security', sub: 'Fingerprint / face sign-in, alerts, devices' },
];

export function MorePage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [pw, setPw] = useState(false);
  return (
    <>
      <TopBar title="More" />
      <main className="page stack" style={{ paddingTop: 12 }}>
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
        <div className="list">
          <div className="list-item">
            <div className="grow">
              <div className="strong">{me?.user.displayName}</div>
              <div className="small muted">
                Signed in as {me?.user.username} · {me?.user.role === 'owner' ? 'Owner' : 'Team member'}
              </div>
            </div>
          </div>
          <button className="list-item" style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left' }} onClick={() => setPw(true)}>
            <div className="grow strong">Change password</div>
          </button>
          <button
            className="list-item"
            style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left', color: 'var(--bad)' }}
            onClick={async () => {
              await api.post('/api/auth/logout').catch(() => {});
              qc.setQueryData(['me'], null);
              qc.clear();
            }}
          >
            <Icon name="logout" /> <span className="strong">Sign out</span>
          </button>
        </div>
        <div className="tiny muted center">
          Tip: add Slay to your Home Screen (Share → Add to Home Screen on iPhone, ⋮ → Install app on Android) so it opens like an app.
        </div>
      </main>
      {pw && <PasswordSheet onClose={() => setPw(false)} />}
    </>
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
