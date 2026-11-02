import { useSyncExternalStore } from 'react';
import { applyUpdate, onUpdateAvailable, updateAvailable } from '../lib/pwa';

/** "New version available – tap to update": only when a new version of Slay really is ready. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(onUpdateAvailable, updateAvailable);
  if (!ready) return null;
  return (
    <button type="button" className="update-banner" onClick={applyUpdate}>
      <span aria-hidden="true">↻</span> New version available – tap to update
    </button>
  );
}
