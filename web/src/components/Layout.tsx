import { LIVE_EVENTS } from '@slay/shared';
import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigationType, type Location } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveSync } from '../lib/live';
import type { Alert } from '../lib/types';
import { BiometricOffer } from './BiometricOffer';
import { Icon } from './Icon';
import { NotificationOffer } from './NotificationOffer';
import { cancelVoice, ListeningBar } from './FieldVoice';
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
  const { location, direction } = useScreenTransition();
  // Leaving a screen stops any voice listening for its fields.
  useEffect(() => cancelVoice, [location.pathname]);
  return (
    <LiveCtx.Provider value={connected}>
      <div className="app">
        <div key={location.pathname} className={`screen screen-${direction}`}>
          <Outlet />
        </div>
        <ListeningBar />
        <BiometricOffer />
        <NotificationOffer />
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

const TABS = new Set(['/', '/orders', '/stock', '/more']);
const depth = (path: string) => path.split('/').filter(Boolean).length;
const scrollPositions = new Map<string, number>();

/**
 * Native-style screen changes: going deeper slides in from the right, going back slides in from
 * the left, switching tabs cross-fades. Scroll position is kept for each screen so going back
 * lands exactly where you were; new screens start at the top.
 */
function useScreenTransition() {
  const location = useLocation();
  const type = useNavigationType();
  const prev = useRef<Location | null>(null);
  const direction = useRef<'none' | 'forward' | 'back' | 'fade'>('none');

  if (prev.current && prev.current.pathname !== location.pathname && prev.current.key !== location.key) {
    direction.current =
      type === 'POP' ? 'back' : TABS.has(location.pathname) ? 'fade' : depth(location.pathname) >= depth(prev.current.pathname) ? 'forward' : 'back';
  }

  useLayoutEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }, []);
  useLayoutEffect(() => {
    const from = prev.current;
    prev.current = location;
    if (!from || from.pathname === location.pathname) return;
    window.scrollTo(0, type === 'POP' ? scrollPositions.get(location.key) ?? 0 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  useLayoutEffect(() => {
    const save = () => scrollPositions.set(location.key, window.scrollY);
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [location.key]);

  return { location, direction: direction.current };
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
