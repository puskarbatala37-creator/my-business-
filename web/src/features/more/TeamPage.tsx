import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon } from '../../components/Icon';
import { Seg, Sheet, Spinner, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { dateTime } from '../../lib/format';
import type { TeamMember } from '../../lib/types';

type Role = 'owner' | 'member';

/**
 * Team accounts. Adding someone = name + email + a starting password. They add (and confirm)
 * their own mobile number the first time they sign in.
 * Owners manage the team; members can do all day-to-day work (orders, stock, bills).
 */
export function TeamPage() {
  const { me } = useAuth();
  const isOwner = me?.user.role === 'owner';
  const q = useQuery({ queryKey: ['team'], queryFn: () => api.get<{ team: TeamMember[] }>('/api/auth/team') });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);

  return (
    <>
      <TopBar title="Team" back="/more" />
      <main className="page stack" style={{ paddingTop: 12 }}>
        {isOwner && (
          <button className="btn primary block" onClick={() => setAdding(true)}>
            <Icon name="team" size={20} /> Add team member
          </button>
        )}
        {!q.data ? (
          <Spinner />
        ) : (
          <div className="list">
            {q.data.team.map((u) => (
              <button
                key={u.id}
                type="button"
                className="list-item"
                style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left', opacity: u.active ? 1 : 0.55 }}
                onClick={() => isOwner && setEditing(u)}
                disabled={!isOwner}
              >
                <span className="thumb" style={{ width: 40, height: 40, borderRadius: 20, fontWeight: 700, color: 'var(--accent)' }}>
                  {u.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div className="grow">
                  <div className="strong">
                    {u.displayName} {u.id === me?.user.id && <span className="tiny muted">(you)</span>}
                  </div>
                  <div className="tiny muted">
                    {u.email} · {u.last_seen_at ? `active ${dateTime(u.last_seen_at)}` : 'not signed in yet'}
                    {u.active && (u.needs_email || !u.has_phone) && (
                      <span className="badge warn" style={{ marginLeft: 6 }}>
                        {u.needs_email ? 'No email yet' : 'No phone yet'}
                      </span>
                    )}
                    {u.passkeys > 0 && ' · uses fingerprint/face'}
                  </div>
                </div>
                {!u.active ? <span className="badge neutral">Switched off</span> : <span className={`badge ${u.role === 'owner' ? 'info' : 'neutral'}`}>{u.role === 'owner' ? 'Owner' : 'Member'}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="tiny muted">
          <strong>Members</strong> can take orders, update stock and save bills. <strong>Owners</strong> can also add or switch off team members and reset passwords.
          Everyone gets security alerts.
        </div>
      </main>
      {adding && <AddMember onClose={() => setAdding(false)} />}
      {editing && <EditMember u={editing} self={editing.id === me?.user.id} onClose={() => setEditing(null)} />}
    </>
  );
}

function AddMember({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Add team member" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api.post('/api/auth/team', { displayName, email, phone, password, role });
            qc.invalidateQueries({ queryKey: ['team'] });
            qc.invalidateQueries({ queryKey: ['me'] });
            toast(`${displayName} can now sign in with ${email.trim().toLowerCase()}`);
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Name
          <input className="input" autoFocus value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label className="field">
          Email (they sign in with this)
          <input className="input" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          Mobile number (optional – otherwise they add it when they first sign in)
          <input className="input" type="tel" inputMode="tel" autoComplete="off" placeholder="98XXXXXXXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          Starting password (at least 8 characters – they can change it later)
          <input className="input" type="text" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        <Seg value={role} onChange={setRole} options={[{ value: 'member', label: 'Team member' }, { value: 'owner', label: 'Owner' }]} />
        <button className="btn primary block" disabled={busy}>
          Add {displayName || 'member'}
        </button>
      </form>
    </Sheet>
  );
}

function EditMember({ u, self, onClose }: { u: TeamMember; self: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(u.needs_email ? '' : u.email);
  const save = async (patch: Record<string, unknown>, done: string) => {
    try {
      await api.patch(`/api/auth/team/${u.id}`, patch);
      qc.invalidateQueries({ queryKey: ['team'] });
      qc.invalidateQueries({ queryKey: ['me'] });
      toast(done);
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  return (
    <Sheet title={u.displayName} onClose={onClose}>
      <div className="stack">
        <div className="small muted">{u.email}</div>
        <Seg
          value={u.role}
          onChange={(r) => r !== u.role && save({ role: r }, `${u.displayName} is now ${r === 'owner' ? 'an owner' : 'a team member'}`)}
          options={[
            { value: 'member', label: 'Team member' },
            { value: 'owner', label: 'Owner' },
          ]}
        />
        {!self && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save({ email }, `${u.displayName} now signs in with ${email.trim().toLowerCase()}`);
            }}
          >
            <label className="field">
              Sign-in email for {u.displayName}
              <input className="input" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <button className="btn block" disabled={email.trim().toLowerCase() === u.email}>
              Change email
            </button>
          </form>
        )}
        {!self && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              save({ password }, `Password reset – give ${u.displayName} the new password`);
            }}
          >
            <label className="field">
              New password for {u.displayName}
              <input className="input" type="text" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
            </label>
            <button className="btn block">Reset password</button>
          </form>
        )}
        {!self &&
          (u.active ? (
            <button className="btn danger block" onClick={() => confirm(`Switch off ${u.displayName}'s account? They will be signed out everywhere.`) && save({ active: false }, `${u.displayName} was switched off`)}>
              Switch off account
            </button>
          ) : (
            <button className="btn block" onClick={() => save({ active: true }, `${u.displayName} can sign in again`)}>
              Switch account back on
            </button>
          ))}
        <div className="tiny muted">Switching an account off keeps all their orders and history – it only stops them signing in.</div>
      </div>
    </Sheet>
  );
}
