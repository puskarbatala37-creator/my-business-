import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/ui';
import { AuthProvider } from './lib/auth';
import { persistQueries, restoreQueries } from './lib/persist';
import { hideSplash, initPwa } from './lib/pwa';
import './styles.css';

/** Demo preview build: the whole app (server included) runs in the browser with sample data. */
const IS_DEMO = import.meta.env.VITE_DEMO === '1';

const queryClient = new QueryClient({
  defaultOptions: {
    // Screens seen recently stay in memory (and saved on the phone) for a day, so going back is instant.
    queries: { staleTime: 30_000, gcTime: 24 * 60 * 60 * 1000, refetchOnWindowFocus: true, retry: 1 },
  },
});

initPwa({ serviceWorker: import.meta.env.PROD && !IS_DEMO });

async function start() {
  let banner: ReactNode = null;
  if (!IS_DEMO) {
    // Open straight onto the last-seen screens (also with no internet), then refresh them live.
    await restoreQueries(queryClient);
    persistQueries(queryClient);
  }
  if (import.meta.env.VITE_DEMO === '1') {
    const { bootDemo } = await import('./demo/boot');
    const { DemoBanner } = await import('./demo/DemoBanner');
    await bootDemo();
    // The preview host blocks confirm() pop-ups (they always answer "no"), so in the demo
    // confirmation steps go straight through.
    window.confirm = () => true;
    banner = <DemoBanner />;
  }
  // The hosted preview keeps navigation inside the page instead of in the address bar.
  const Router = IS_DEMO ? MemoryRouter : BrowserRouter;
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <Router>
          <ToastProvider>
            <AuthProvider>
              {banner}
              <App />
            </AuthProvider>
          </ToastProvider>
        </Router>
      </QueryClientProvider>
    </StrictMode>,
  );
}

start().catch((e) => {
  hideSplash();
  document.getElementById('root')!.innerHTML = `<div style="padding:24px;font-family:system-ui">Slay could not start: ${String(e?.message ?? e)}</div>`;
  console.error(e);
});
