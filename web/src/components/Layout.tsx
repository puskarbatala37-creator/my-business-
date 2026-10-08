import { LIVE_EVENTS } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveSync } from '../lib/live';
import type { Alert } from '../lib/types';
import { BiometricOffer } from './BiometricOffer';
import { Icon } from './Icon';
import { useToast } from './ui';

const LiveCtx = createContext(false);
export const useLiveConnected = () => useContext(LiveCtx);

export function Layout() {
  const { me } = useAuth();
  const toast = useToast();
  const connected = useLiveSync(me?.user.id, (e) => {
    // Tell this user what a teammate just did (not their own actions).
    // Security notifications (first sign-in on a device, suspicious activity) pop up;
    // routine activity is only recorded in the Security log.
    if (e.type === LIVE_EVENTS.alert) {
      if (e.severity !== 'info') toast(`⚠ ${e.message}`, true);
    }
    else if (e.message && e.actor && e.actor.id !== me?.user.id) toast(e.message);
    else if (e.type === LIVE_EVENTS.payment && e.message) toast(e.message);
  });
  return (
    <LiveCtx.Provider value={connected}>
      <div className="app">
        <Outlet />
        <BiometricOffer />
        <nav className="bottom-nav no-print" aria-label="Main">
          <div className="bottom-nav-inner">
            <NavLink to="/" end>
              <Icon name="home" />
              Home
            </NavLink>
            <NavLink to="/orders">
              <Icon name="orders" />
              Orders
            </NavLink>
            <NavLink to="/orders/new" aria-label="New order" className="new">
              <span className="new-btn">
                <Icon name="plus" size={26} stroke={2.5} />
              </span>
            </NavLink>
            <NavLink to="/stock">
              <Icon name="stock" />
              Stock
            </NavLink>
            <NavLink to="/more">
              <Icon name="more" />
              More
            </NavLink>
          </div>
        </nav>
      </div>
    </LiveCtx.Provider>
  );
}

/** Bell with unread security alerts + live-sync indicator; used in top bars. */
export function HeaderActions({ children }: { children?: ReactNode }) {
  const nav = useNavigate();
  const connected = useLiveConnected();
  const alerts = useQuery({ queryKey: ['alerts'], queryFn: () => api.get<{ alerts: Alert[]; unread: number }>('/api/security/alerts') });
  const unread = alerts.data?.unread ?? 0;
  return (
    <>
      {children}
      <span className={`live ${connected ? 'on' : ''}`} title={connected ? 'Live – synced with the team' : 'Reconnecting…'} aria-label={connected ? 'Live sync on' : 'Live sync reconnecting'} />
      <button className="icon-btn" aria-label={`Security alerts${unread ? `, ${unread} unread` : ''}`} onClick={() => nav('/more/security')}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </>
  );
}
