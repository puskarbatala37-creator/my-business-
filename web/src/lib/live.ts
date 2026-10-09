import type { LiveEvent } from '@slay/shared';
import { LIVE_EVENTS } from '@slay/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { reportNetwork } from './online';

/** Which cached screens to refresh for each live event. */
const INVALIDATES: Record<string, string[][]> = {
  [LIVE_EVENTS.stock]: [['catalog'], ['variant'], ['dashboard']],
  [LIVE_EVENTS.catalog]: [['catalog'], ['variant']],
  [LIVE_EVENTS.order]: [['orders'], ['order'], ['dashboard'], ['customers'], ['customer']],
  [LIVE_EVENTS.payment]: [['orders'], ['order'], ['dashboard']],
  [LIVE_EVENTS.customer]: [['customers'], ['customer']],
  [LIVE_EVENTS.receipt]: [['receipts'], ['dashboard']],
  [LIVE_EVENTS.alert]: [['alerts'], ['trusted-devices']],
};

/**
 * Keeps this phone in sync with the rest of the team's: listens to the server's event
 * stream and refreshes affected data instantly. Reconnects automatically and
 * refreshes everything after coming back online / to the foreground.
 */
export function useLiveSync(userId: number | undefined, onEvent?: (e: LiveEvent) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let dropped = false;
    const open = () => {
      es = new EventSource('/api/live');
      es.onopen = () => {
        setConnected(true);
        reportNetwork(true);
        // Back after a drop (no signal, server restart): catch up on anything missed.
        if (dropped) qc.invalidateQueries();
        dropped = false;
      };
      es.onerror = () => {
        dropped = true;
        setConnected(false);
        if (es?.readyState === EventSource.CLOSED) retry = setTimeout(open, 3000);
      };
      es.onmessage = (msg) => {
        const e = JSON.parse(msg.data) as LiveEvent;
        for (const key of INVALIDATES[e.type] ?? []) qc.invalidateQueries({ queryKey: key });
        onEvent?.(e);
      };
    };
    open();
    const refreshAll = () => {
      if (document.visibilityState === 'visible') qc.invalidateQueries();
    };
    document.addEventListener('visibilitychange', refreshAll);
    window.addEventListener('online', refreshAll);
    return () => {
      clearTimeout(retry);
      es?.close();
      document.removeEventListener('visibilitychange', refreshAll);
      window.removeEventListener('online', refreshAll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, qc]);

  return connected;
}
