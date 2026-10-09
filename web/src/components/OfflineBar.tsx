import { useEffect, useRef, useState } from 'react';
import { useOnline } from '../lib/online';

/**
 * A slim strip under the title bar saying when there's no internet (and that what's shown is
 * the copy saved on this phone), then briefly "Back online" when the connection returns.
 */
export function OfflineBar({ floating = false }: { floating?: boolean }) {
  const online = useOnline();
  const [back, setBack] = useState(false);
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current) {
      setBack(true);
      const t = setTimeout(() => setBack(false), 2500);
      was.current = online;
      return () => clearTimeout(t);
    }
    was.current = online;
  }, [online]);
  if (online && !back) return null;
  return (
    <div className={`net-bar ${online ? 'ok' : 'off'} ${floating ? 'floating' : ''}`} role="status" aria-live="polite">
      <span className="net-dot" />
      {online ? 'Back online – everything is up to date' : 'Offline – showing what’s saved on this phone. New orders and changes need internet.'}
    </div>
  );
}
