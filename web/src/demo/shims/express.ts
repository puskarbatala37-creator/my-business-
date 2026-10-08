/** Tiny browser stand-in for Express's Router, so the real server route files run in the demo. */
import { match } from 'path-to-regexp';

type Handler = (req: any, res: any, next: (err?: unknown) => void) => unknown;
interface Layer {
  method: string;
  matcher: ReturnType<typeof match>;
  handlers: Handler[];
}

async function runChain(handlers: Handler[], req: any, res: any) {
  for (const h of handlers) {
    let nextCalled = false;
    let nextErr: unknown;
    const r = h(req, res, (err?: unknown) => {
      nextCalled = true;
      nextErr = err;
    });
    if (r && typeof (r as Promise<unknown>).then === 'function') await r;
    if (nextErr) throw nextErr;
    if (!nextCalled) return;
  }
}

export function Router() {
  const layers: Layer[] = [];
  const router: any = {
    async handle(req: any, res: any): Promise<boolean> {
      const path = req.path || '/';
      for (const l of layers) {
        if (l.method !== req.method) continue;
        const m = l.matcher(path);
        if (!m) continue;
        req.params = m.params;
        await runChain(l.handlers, req, res);
        return true;
      }
      return false;
    },
    use() {
      return router;
    },
  };
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    router[method] = (path: string, ...handlers: Handler[]) => {
      layers.push({ method: method.toUpperCase(), matcher: match(path, { decode: decodeURIComponent }), handlers });
      return router;
    };
  }
  return router;
}

const noop = () => (_req: unknown, _res: unknown, next: () => void) => next();
export default { Router, static: noop, json: noop };
