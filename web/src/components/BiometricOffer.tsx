import { useEffect, useState } from 'react';
import { JUST_USED_PASSWORD } from '../features/auth/LoginPage';
import { biometricAvailable, biometricEnrolledHere, biometricName, enrollBiometric, markOffered, wasOffered } from '../lib/biometric';
import { Icon } from './Icon';
import { Sheet, useToast } from './ui';

/** After a password sign-in on a phone with a fingerprint / face sensor, offer to make biometrics the main login. */
export function BiometricOffer() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let justUsedPassword = false;
    try {
      justUsedPassword = sessionStorage.getItem(JUST_USED_PASSWORD) === '1';
      sessionStorage.removeItem(JUST_USED_PASSWORD);
    } catch {}
    if (!justUsedPassword || biometricEnrolledHere() || wasOffered()) return;
    biometricAvailable().then((ok) => ok && setOpen(true));
  }, []);

  if (!open) return null;
  const close = () => {
    markOffered();
    setOpen(false);
  };
  return (
    <Sheet title="Faster sign-in" onClose={close}>
      <div className="stack center">
        <div style={{ color: 'var(--accent)', margin: '8px auto' }}>
          <Icon name="fingerprint" size={56} stroke={1.5} />
        </div>
        <div>
          Use <strong>{biometricName}</strong> to sign in to Slay on this phone? Your password still works as a backup.
        </div>
        <div className="tiny muted">Your fingerprint or face never leaves the phone – Slay only receives a secure confirmation.</div>
        <button
          className="btn primary block"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await enrollBiometric();
              toast(`${biometricName} sign-in is on`);
              setOpen(false);
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Turn on {biometricName}
        </button>
        <button className="btn ghost block" onClick={close}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}
