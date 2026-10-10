import { useEffect, useState, useSyncExternalStore } from 'react';
import { canPromptInstall, inAppBrowser, installedBefore, iosOtherBrowser, isAndroid, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/pwa';
import { Icon } from './Icon';
import { Sheet, useToast } from './ui';

const DISMISSED = 'slay.install.dismissed';
const ASK_AGAIN_AFTER = 7 * 24 * 60 * 60 * 1000;
/** Open the install sheet from anywhere (e.g. More → Install the app). */
export const OPEN_INSTALL = 'slay:install';
let shownThisVisit = false;

/** Whether "Install the app" makes sense here (not already installed, not the preview). */
export function canInstallHere() {
  return import.meta.env.VITE_DEMO !== '1' && !isStandalone();
}

function recentlyDismissed() {
  try {
    const t = Number(localStorage.getItem(DISMISSED) ?? 0);
    return Date.now() - t < ASK_AGAIN_AFTER || localStorage.getItem('slay.installed') === '1';
  } catch {
    return false;
  }
}

/**
 * The first time someone opens Slay in a browser, explain how to put it on their home screen:
 * a one-tap Install button where the browser supports it (Android Chrome, computers), otherwise
 * short step-by-step instructions for their exact phone and browser.
 */
export function InstallPrompt() {
  const [open, setOpen] = useState(false);
  /** Why the manual steps are shown instead of the one-tap button (after it didn't work). */
  const [note, setNote] = useState<string | null>(null);
  const oneTap = useSyncExternalStore(onInstallChange, canPromptInstall);
  const toast = useToast();

  useEffect(() => {
    const show = () => {
      setNote(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_INSTALL, show);
    let t: ReturnType<typeof setTimeout> | undefined;
    // Never pop up over someone typing (e.g. halfway through signing in) or over another panel:
    // wait until they pause.
    const busy = () => !!document.querySelector('.sheet') || !!document.activeElement?.matches('input, textarea, select');
    const tryShow = () => {
      if (shownThisVisit) return;
      if (busy()) {
        t = setTimeout(tryShow, 1500);
        return;
      }
      shownThisVisit = true;
      setOpen(true);
    };
    if (canInstallHere() && !shownThisVisit && !recentlyDismissed()) t = setTimeout(tryShow, 1200);
    return () => {
      clearTimeout(t);
      window.removeEventListener(OPEN_INSTALL, show);
    };
  }, []);

  if (!open) return null;
  const close = () => {
    shownThisVisit = true;
    try {
      localStorage.setItem(DISMISSED, String(Date.now()));
    } catch {}
    setOpen(false);
  };

  return (
    <Sheet title="Get the Slay app" onClose={close}>
      <div className="stack install">
        <div className="row" style={{ gap: 14 }}>
          <img src="/icons/icon-192.png" alt="" width={64} height={64} className="install-icon" />
          <div className="grow">
            <div className="strong">Slay</div>
            <div className="small muted">Orders &amp; stock · free</div>
          </div>
        </div>
        <ul className="install-perks">
          <li>Opens full screen from your home screen, like any app</li>
          <li>Starts instantly and shows saved orders and stock with no signal</li>
          <li>Security alerts and fingerprint / face sign-in</li>
        </ul>

        {installedBefore() && (
          <div className="alert-banner info" role="status">
            <span>
              Slay looks already installed on this phone. Look for the <strong>Slay</strong> icon on your home screen or in your app list and open it
              from there. If it isn’t there, install it with the steps below.
            </span>
          </div>
        )}
        {note && (
          <div className="alert-banner warning" role="status">
            <span>{note}</span>
          </div>
        )}

        {inAppBrowser ? (
          <>
            <ol className="install-steps">
              <li>
                Tap the <strong>⋯</strong> or <strong>⋮</strong> menu in the corner of this screen
              </li>
              <li>
                Choose <strong>Open in {isIOS ? 'Safari' : 'browser'}</strong> ({isIOS ? 'or “Open in external browser”' : 'Chrome'})
              </li>
              <li>Then install Slay from there – it only takes a moment</li>
            </ol>
            <button
              className="btn primary block"
              onClick={() =>
                navigator.clipboard?.writeText(location.origin).then(
                  () => toast('Link copied – paste it into Safari or Chrome'),
                  () => toast(location.origin),
                )
              }
            >
              Copy the link
            </button>
          </>
        ) : oneTap ? (
          <button
            className="btn primary block"
            onClick={async () => {
              const outcome = await promptInstall();
              if (outcome === 'accepted') {
                toast('Slay is being added to your home screen');
                setOpen(false);
              } else if (outcome === 'dismissed') {
                setNote('Not installed. You can install Slay any time with the steps below.');
              } else {
                setNote('Your browser didn’t open its install window. Install Slay with these steps instead:');
              }
            }}
          >
            <Icon name="plus" /> Install Slay
          </button>
        ) : isIOS ? (
          <ol className="install-steps">
            <li>
              Tap <Glyph name="share" /> <strong>Share</strong> {iosOtherBrowser ? 'in the address bar' : 'at the bottom of Safari'}{' '}
              <span className="muted">(on newer iPhones it's inside the ••• button)</span>
            </li>
            <li>
              Scroll down and tap <Glyph name="add" /> <strong>Add to Home Screen</strong>
            </li>
            <li>
              Tap <strong>Add</strong> – then open Slay from your home screen
            </li>
          </ol>
        ) : isAndroid ? (
          <ol className="install-steps">
            <li>
              Tap the <strong>⋮</strong> menu at the top right of Chrome
            </li>
            <li>
              Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>)
            </li>
            <li>
              Tap <strong>Install</strong> – Slay appears with your other apps
            </li>
          </ol>
        ) : (
          <ol className="install-steps">
            <li>
              Open your browser's menu (or the install icon <Glyph name="add" /> in the address bar)
            </li>
            <li>
              Choose <strong>Install Slay</strong> / <strong>Add to Home Screen</strong>
            </li>
          </ol>
        )}
        <button className="btn ghost block" onClick={close}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/** Small drawings of the iPhone Share / Add buttons so the steps are easy to follow. */
function Glyph({ name }: { name: 'share' | 'add' }) {
  return (
    <span className="install-glyph" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {name === 'share' ? <path d="M8 10H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2M16 6l-4-4-4 4M12 2v13" /> : <path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM12 8v8M8 12h8" />}
      </svg>
    </span>
  );
}
