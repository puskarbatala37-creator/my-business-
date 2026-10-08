import { PAYMENT_STATUS_LABELS, platformLabel, type FulfillmentStatus, type OrderState, type PaymentStatus } from '@slay/shared';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadPhoto } from '../lib/image';
import { Icon } from './Icon';

// ── Toasts ──────────────────────────────────────────────────────────────
type Toast = { id: number; text: string; error?: boolean };
const ToastCtx = createContext<(text: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, error = false) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 5000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ── Page chrome ─────────────────────────────────────────────────────────
export function TopBar({ title, back, actions }: { title: ReactNode; back?: boolean | string; actions?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        {back && (
          <button className="icon-btn" aria-label="Back" onClick={() => (typeof back === 'string' ? nav(back) : history.length > 1 ? nav(-1) : nav('/'))}>
            <Icon name="back" />
          </button>
        )}
        <h1>{title}</h1>
        {actions}
      </div>
    </header>
  );
}

export const Spinner = () => <div className="spinner" aria-label="Loading" />;
export const Empty = ({ children }: { children: ReactNode }) => <div className="empty">{children}</div>;

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ── Status badges (always text + colour, never colour alone) ────────────
export function PaymentBadge({ status, balance }: { status: PaymentStatus; balance?: number }) {
  const tone = status === 'paid' ? 'good' : status === 'partial' ? 'warn' : 'bad';
  const label = status === 'partial' && balance ? `Partial · Rs ${balance.toLocaleString('en-IN')} due` : status === 'unpaid' ? 'COD / unpaid' : PAYMENT_STATUS_LABELS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function FulfillmentBadge({ status, state }: { status: FulfillmentStatus; state?: OrderState }) {
  if (state && state !== 'active') return <span className="badge neutral">{state[0].toUpperCase() + state.slice(1)}</span>;
  return status === 'sent' ? <span className="badge info">Sent</span> : <span className="badge neutral">Pending</span>;
}

/** Where the order came from. The coloured dot is the platform's brand colour; the name is always written out. */
export function PlatformBadge({ platform }: { platform: string | null | undefined }) {
  return (
    <span className={`badge platform platform-${platform ?? 'unknown'}`}>
      <span className="platform-dot" aria-hidden="true" />
      {platformLabel(platform)}
    </span>
  );
}

export function StockBadge({ stock }: { stock: number }) {
  if (stock <= 0) return <span className="badge bad">Out of stock</span>;
  if (stock <= 1) return <span className="badge warn">{stock} left</span>;
  return <span className="badge neutral">{stock} in stock</span>;
}

// ── Inputs ──────────────────────────────────────────────────────────────
export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button type="button" key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ value, onChange, min = 1, max = 999 }: { value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Less" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span>{value}</span>
      <button type="button" aria-label="More" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  );
}

export function Thumb({ src, size = 'md' }: { src?: string | null; size?: 'md' | 'lg' }) {
  return <div className={`thumb ${size === 'lg' ? 'lg' : ''}`}>{src ? <img src={src} alt="" loading="lazy" /> : <Icon name="image" size={20} />}</div>;
}

/** Tap to take a photo with the camera (or choose from the gallery). Uploads immediately. */
export function PhotoInput({
  value,
  onChange,
  label = 'Add photo',
  height = 120,
  width = '100%',
  onCaptured,
}: {
  value: string | null | undefined;
  onChange: (path: string | null) => void;
  label?: string;
  height?: number;
  width?: number | string;
  onCaptured?: (at: Date) => void;
}) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <div className="photo-input" style={{ height, width }}>
      {busy ? <div className="spinner" style={{ margin: 0 }} /> : value ? <img src={value} alt="" /> : (
        <div className="center small">
          <Icon name="camera" />
          <div>{label}</div>
        </div>
      )}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          onCaptured?.(new Date());
          setBusy(true);
          try {
            onChange(await uploadPhoto(file));
          } catch (err) {
            toast((err as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

export function MoneyInput({ value, onChange, placeholder, autoFocus }: { value: number | ''; onChange: (n: number | '') => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      className="input num"
      inputMode="decimal"
      autoFocus={autoFocus}
      placeholder={placeholder ?? 'Rs'}
      value={value}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, '');
        onChange(v === '' ? '' : Number(v));
      }}
    />
  );
}
