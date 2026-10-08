import type { Response } from 'express';
import type { LiveEvent, LiveEventName } from '@slay/shared';

type Listener = (e: LiveEvent) => void;

/**
 * In-process event bus. Domain modules publish events after they change data;
 * the SSE endpoint fans them out to every connected device so every team member
 * always see the same stock and orders. Other modules (alerts, push, future
 * integrations) can subscribe too.
 */
export class EventBus {
  private listeners = new Set<Listener>();

  publish(type: LiveEventName, data: Omit<LiveEvent, 'type' | 'at'> = { actor: null }) {
    const event: LiveEvent = { type, at: new Date().toISOString(), ...data };
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        console.error('event listener failed', err);
      }
    }
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

/** Streams bus events to a browser using Server-Sent Events. */
export function streamEvents(bus: EventBus, res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  const unsubscribe = bus.subscribe((e) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}
