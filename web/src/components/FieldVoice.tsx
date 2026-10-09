import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore, type ReactNode } from 'react';
import { api } from '../lib/api';
import { listenOnce, saveLang, savedLang, type Listening, type SpeechLang } from '../lib/speech';
import { Icon } from './Icon';
import { useToast } from './ui';

/**
 * Voice, one field at a time: every field has a small mic. Tap it, say just that value
 * ("October 10", "42", "black cotton kurta", "इसेवा"), and only that field is filled – the server
 * reads the words as what that field expects (a date, a size from the product's list, a product…).
 */

export type VoiceKind =
  | 'text' | 'name' | 'handle' | 'phone' | 'tracking' | 'number' | 'money' | 'date' | 'size'
  | 'platform' | 'payment_status' | 'payment_method' | 'category' | 'product' | 'option';

type FieldAnswer =
  | { ok: true; value: string | number; display: string }
  | { ok: true; candidates: number[]; display: string }
  | { ok: false; message: string };

interface Session {
  id: string;
  label: string;
  phase: 'listening' | 'reading';
  heard: string;
  lang: SpeechLang;
  listening: Listening | null;
}

// ── One shared listening session for the whole app ──
let session: Session | null = null;
let lang: SpeechLang = savedLang();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const update = (patch: Partial<Session>) => {
  if (session) session = { ...session, ...patch };
  emit();
};
const useSession = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => session,
  );

/** Stops whatever is being listened to (e.g. leaving the screen). */
export function cancelVoice() {
  session?.listening?.cancel();
  session = null;
  emit();
}

interface MicProps {
  /** What this field is called, shown while listening ("Say the delivery date"). */
  label: string;
  kind: VoiceKind;
  onValue: (value: any, display: string) => void;
  /** Products: more than one matched – let the person choose. */
  onCandidates?: (ids: number[]) => void;
  /** Sizes of this product, or the choices of an `option` field. */
  options?: (string | { value: string; label: string })[];
  /** Dates: a delivery date is in the future, an order date today or before. */
  prefer?: 'future' | 'past';
  disabled?: boolean;
}

export function MicButton({ label, kind, onValue, onCandidates, options, prefer, disabled }: MicProps) {
  const toast = useToast();
  const cfg = useQuery({ queryKey: ['voice-config'], queryFn: () => api.get<{ serverTranscription: boolean }>('/api/voice/config'), staleTime: Infinity });
  const s = useSession();
  const id = `${kind}:${label}`;
  const active = s?.id === id;

  const start = async (useLang: SpeechLang = lang) => {
    session?.listening?.cancel();
    session = { id, label, phase: 'listening', heard: '', lang: useLang, listening: null };
    emit();
    const listening = listenOnce(useLang, !!cfg.data?.serverTranscription, (heard) => session?.id === id && update({ heard }));
    update({ listening });
    // The bar's language switch restarts listening in the other language.
    restart = (l: SpeechLang) => {
      lang = l;
      saveLang(l);
      void start(l);
    };
    let words = '';
    try {
      words = await listening.result;
    } catch (e) {
      if (session?.id === id && session.listening === listening) {
        session = null;
        emit();
        toast((e as Error).message, true);
      }
      return;
    }
    if (session?.id !== id || session.listening !== listening) return; // cancelled or restarted
    if (!words) {
      session = null;
      emit();
      toast(`Didn’t hear anything. Tap the mic and say the ${label.toLowerCase()}.`, true);
      return;
    }
    update({ phase: 'reading', heard: words });
    try {
      const answer = await api.post<FieldAnswer>('/api/voice/field', {
        kind,
        text: words,
        prefer,
        options: options?.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)),
      });
      if (!answer.ok) toast(`“${words}” – ${answer.message}`, true);
      else if ('candidates' in answer) onCandidates?.(answer.candidates);
      else {
        onValue(answer.value, answer.display);
        toast(`${label}: ${answer.display}`);
      }
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      if (session?.id === id) {
        session = null;
        emit();
      }
    }
  };

  const toggle = () => {
    if (disabled) return;
    if (active) session?.listening?.finish();
    else void start();
  };

  return (
    // A span acting as a button: a real <button> inside a field's <label> would become what the
    // label points at, so tapping the field's name would start listening instead of typing.
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      className={`mic-btn ${active ? 'on' : ''}`}
      aria-label={active ? `Stop listening for ${label.toLowerCase()}` : `Say the ${label.toLowerCase()}`}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      onClick={(e) => {
        e.preventDefault(); // don't let the surrounding label focus its input / open the keyboard
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <Icon name="mic" size={18} />
    </span>
  );
}
let restart: (l: SpeechLang) => void = () => {};

/** A field's label line with its mic on the right – the same place for every kind of field. */
export function FieldHead({ text, children }: { text: ReactNode; children?: ReactNode }) {
  return (
    <span className="field-head">
      <span>{text}</span>
      {children}
    </span>
  );
}

/** While listening: which field, what's being heard, language switch, cancel. Shown above the bottom bar. */
export function ListeningBar() {
  const s = useSession();
  if (!s) return null;
  return (
    <div className="listening-bar" role="status" aria-live="polite">
      <span className={`listening-dot ${s.phase}`} aria-hidden="true">
        <Icon name="mic" size={18} />
      </span>
      <div className="grow">
        <div className="strong small">{s.phase === 'reading' ? `Filling in ${s.label.toLowerCase()}…` : `Say the ${s.label.toLowerCase()}`}</div>
        <div className="listening-heard">{s.heard ? `“${s.heard}”` : 'Listening…'}</div>
      </div>
      {s.phase === 'listening' && (
        <div className="listening-actions">
          <div className="seg" role="radiogroup" aria-label="Speaking language">
            {(['ne-NP', 'en-US'] as SpeechLang[]).map((l) => (
              <button key={l} type="button" role="radio" aria-checked={s.lang === l} className={s.lang === l ? 'on' : ''} onClick={() => s.lang !== l && restart(l)}>
                {l === 'ne-NP' ? 'नेपाली' : 'English'}
              </button>
            ))}
          </div>
          <button type="button" className="btn sm" onClick={cancelVoice}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
