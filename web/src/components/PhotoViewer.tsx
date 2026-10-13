import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from './Icon';

/**
 * Full-screen photo viewer for the whole app: product photos (to tell similar colours apart) and
 * supplier bills (to read the small print). Pinch with two fingers, double-tap or use + to zoom;
 * drag to move around a zoomed photo. Close with ✕, a tap outside the photo, Escape or the phone's
 * Back button – it never leaves the app stuck on a bare image.
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

const MAX_ZOOM = 5;
const STEP_ZOOM = 2.5;

interface View {
  scale: number;
  x: number;
  y: number;
}
const FIT: View = { scale: 1, x: 0, y: 0 };

export function PhotoViewer() {
  const s = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => shown,
  );
  const [view, setView] = useState<View>(FIT);
  const gesture = useRef<{ dist: number; scale: number; x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    if (!s) return;
    setView(FIT);
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
  const zoomed = view.scale > 1.01;
  const clamp = (v: View): View => (v.scale <= 1.01 ? FIT : { ...v, scale: Math.min(MAX_ZOOM, v.scale) });
  const toggleZoom = () => setView((v) => (v.scale > 1.01 ? FIT : { scale: STEP_ZOOM, x: 0, y: 0 }));

  const dist = (t: React.TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label={s.caption ? `Photo: ${s.caption}` : 'Photo'} onClick={close}>
      <div
        className="photo-viewer-stage"
        onClick={(e) => {
          // A tap on the dark area around the photo closes; taps on the photo don't.
          if (e.target === e.currentTarget && !zoomed) close();
          e.stopPropagation();
        }}
        onTouchStart={(e) => {
          const t = e.touches;
          gesture.current = { dist: t.length === 2 ? dist(t) : 0, scale: view.scale, x: view.x, y: view.y, px: t[0].clientX, py: t[0].clientY, moved: false };
        }}
        onTouchMove={(e) => {
          const g = gesture.current;
          if (!g) return;
          const t = e.touches;
          if (t.length === 2 && g.dist) {
            g.moved = true;
            setView(clamp({ scale: Math.max(1, (g.scale * dist(t)) / g.dist), x: g.x, y: g.y }));
          } else if (t.length === 1 && view.scale > 1.01) {
            g.moved = true;
            setView((v) => ({ ...v, x: g.x + (t[0].clientX - g.px) / v.scale, y: g.y + (t[0].clientY - g.py) / v.scale }));
          }
        }}
        onTouchEnd={(e) => {
          const g = gesture.current;
          if (e.touches.length === 0) gesture.current = null;
          // Double-tap toggles zoom (touch screens don't send dblclick reliably).
          if (g && !g.moved && e.changedTouches.length === 1 && e.touches.length === 0) {
            const now = Date.now();
            if (now - lastTap.current < 300) {
              e.preventDefault();
              toggleZoom();
              lastTap.current = 0;
            } else lastTap.current = now;
          } else if (e.touches.length === 1 && gesture.current) {
            // One finger left after a pinch: carry on dragging from here.
            gesture.current = { ...gesture.current, dist: 0, scale: view.scale, x: view.x, y: view.y, px: e.touches[0].clientX, py: e.touches[0].clientY };
          }
        }}
      >
        <img
          src={s.src}
          alt={s.caption ?? ''}
          style={{ transform: `scale(${view.scale}) translate(${view.x}px, ${view.y}px)` }}
          onDoubleClick={toggleZoom}
          draggable={false}
        />
      </div>
      <div className="photo-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="photo-viewer-caption">{s.caption}</span>
        <button type="button" className="photo-viewer-btn" aria-label={zoomed ? 'Zoom out' : 'Zoom in'} onClick={toggleZoom}>
          <span aria-hidden="true" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>
            {zoomed ? '−' : '+'}
          </span>
        </button>
        <button type="button" className="photo-viewer-btn close" aria-label="Close photo" onClick={close}>
          <Icon name="x" size={22} />
        </button>
      </div>
      {/* Always-visible close at the top too, where people look for it. */}
      <button
        type="button"
        className="photo-viewer-btn photo-viewer-top"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        <Icon name="x" size={22} />
      </button>
    </div>
  );
}
