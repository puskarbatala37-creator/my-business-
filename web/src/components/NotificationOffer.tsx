import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { enablePush, pushState, syncPush, type NotificationPrefs } from '../lib/push';
import { Icon } from './Icon';
import { Sheet, useToast } from './ui';

const OFFERED = 'slay.push.offered';

/**
 * Keeps this phone's notification set-up current, and once per phone offers to turn on security
 * notifications (phones only allow asking after a tap, so this is a friendly sheet first).
 */
export function NotificationOffer() {
  const [open, setOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    syncPush();
    const t = setTimeout(async () => {
      try {
        if (localStorage.getItem(OFFERED) || (await pushState()) !== 'off' || Notification.permission !== 'default') return;
        const prefs = await api.get<NotificationPrefs>('/api/security/notifications');
        // Don't stack on top of another question (e.g. the fingerprint offer).
        if (prefs.push && !document.querySelector('.sheet')) setOpen(true);
      } catch {}
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(OFFERED, '1');
    } catch {}
    setOpen(false);
  };
  return (
    <Sheet title="Security alerts" onClose={close}>
      <div className="stack center">
        <div style={{ color: 'var(--accent)', margin: '8px auto' }}>
          <Icon name="bell" size={52} stroke={1.5} />
        </div>
        <div>Get a notification on this phone if someone signs in to Slay from a new device or something suspicious happens – even when Slay is closed.</div>
        <div className="tiny muted">Only for security – never for everyday orders. You can switch it off any time in More → Notifications.</div>
        <button
          className="btn primary block"
          onClick={async () => {
            try {
              await enablePush();
              toast('Security notifications are on for this phone');
            } catch (e) {
              toast((e as Error).message, true);
            }
            close();
          }}
        >
          Turn on notifications
        </button>
        <button className="btn ghost block" onClick={close}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}
