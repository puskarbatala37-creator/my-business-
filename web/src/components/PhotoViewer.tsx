import { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

/**
 * Full-screen photo viewer for the whole app: tap a product photo anywhere to see it large, so
 * similar colours can be told apart. Double-tap (or the zoom button) to look closer, then drag to
 * move around; close with ✕, a tap outside the photo, Escape or the phone's Back button.
 */
interface Shown {
  src: string;
  caption?: string;
}
let shown: Shown | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function openPhoto(src: string, caption?: string) {
  shown = { src, caption };
  emit();
}
function closePhoto() {
  shown = null;
  emit();
}

export function PhotoViewer() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => shown,
  );
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (!s) return;
    setZoom(false);
    // The phone's Back button closes the photo instead of leaving the screen.
    history.pushState({ slayPhoto: true }, '');
    const onPop = () => closePhoto();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && history.back();
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [s]);

  if (!s) return null;
  const close = () => history.back(); // → popstate → closePhoto
  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={s.caption ? `Photo: ${s.caption}` : 'Photo'} onClick={close}>
      <div className={`photo-viewer-stage ${zoom ? 'zoomed' : ''}`} onClick={(e) => e.stopPropagation()}>
        <img
          src={s.src}
          alt={s.caption ?? ''}
          onDoubleClick={() => setZoom((z) => !z)}
          onClick={(e) => {
            e.stopPropagation();
          }}
          draggable={false}
        />
      </div>
      <div className="photo-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="photo-viewer-caption">{s.caption}</span>
        <button type="button" className="photo-viewer-btn" aria-label={zoom ? 'Zoom out' : 'Zoom in'} onClick={() => setZoom((z) => !z)}>
          <span aria-hidden="true" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{zoom ? '−' : '+'}</span>
        </button>
        <button type="button" className="photo-viewer-btn" aria-label="Close photo" onClick={close}>
          <Icon name="x" size={22} />
        </button>
      </div>
    </div>
  );
}
