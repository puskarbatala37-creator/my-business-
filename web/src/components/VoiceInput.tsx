import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Seg, useToast } from './ui';

/** `auto` = server speech-to-text detects Nepali, English or a mix by itself. */
type Lang = 'ne-NP' | 'en-US' | 'auto';

const SpeechRecognitionImpl: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

const EXAMPLES: Record<Lang, string> = {
  'ne-NP': '“रातो साडी दुई वटा ३५०० रुपैयाँ, एक हजार एडभान्स इसेवा, भोलि डेलिभरी”',
  'en-US': '“Two red saris 3500 each, 1000 advance on eSewa, delivery tomorrow”',
  auto: '“रातो साडी दुई वटा, 3500 each, advance 1000 eSewa, भोलि डेलिभरी”',
};

/**
 * Speak the order in Nepali, English, or both. Switch language at any moment –
 * even mid-sentence – and the text keeps building up. The parser understands
 * Nepali, English, romanised Nepali and English words spoken in Nepali.
 *
 * Recognition: the phone's own engine where it supports the language (Chrome on
 * Android does Nepali); otherwise the recording goes to the server's speech-to-text.
 * The text box also works with the keyboard's mic (Gboard does Nepali on both platforms).
 */
export function VoiceInput({ onText, busy }: { onText: (text: string) => void; busy?: boolean }) {
  const toast = useToast();
  const cfg = useQuery({ queryKey: ['voice-config'], queryFn: () => api.get<{ serverTranscription: boolean }>('/api/voice/config'), staleTime: Infinity });
  const server = !!cfg.data?.serverTranscription;
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('slay.voiceLang') as Lang) || 'ne-NP';
    } catch {
      return 'ne-NP';
    }
  });
  const effectiveLang: Lang = lang === 'auto' && !server ? 'ne-NP' : lang;
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const textRef = useRef('');
  const switchTo = useRef<Lang | null>(null);

  const setAllText = (t: string) => {
    textRef.current = t;
    setText(t);
  };

  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Browser engine unless: "auto" (only the server can auto-detect), or Nepali on iPhone (no Nepali dictation) when the server can do it.
  const useBrowserFor = (l: Lang) => !!SpeechRecognitionImpl && l !== 'auto' && !(isIOS && server && l === 'ne-NP');

  function stop() {
    recRef.current?.stop();
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem('slay.voiceLang', l);
    } catch {}
    // Switching while listening: finish this part, then carry on in the new language.
    if (recording) {
      switchTo.current = l;
      stop();
    }
  }

  async function startServerRecording(l: Lang) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const next = switchTo.current;
      switchTo.current = null;
      if (next) void begin(next);
      else setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'speech');
      form.append('language', l === 'auto' ? 'auto' : l.slice(0, 2));
      setInterim('Converting speech to text…');
      try {
        const res = await api.post<{ text: string }>('/api/voice/transcribe', form);
        const all = `${textRef.current} ${res.text.trim()}`.trim();
        setAllText(all);
        if (!next && all) onText(all);
      } catch (e) {
        toast((e as Error).message, true);
      } finally {
        setInterim('');
      }
    };
    mediaRef.current = rec;
    rec.start();
    setRecording(true);
  }

  function startBrowser(l: Lang) {
    const rec = new SpeechRecognitionImpl();
    rec.lang = l;
    rec.continuous = true;
    rec.interimResults = true;
    const before = textRef.current ? textRef.current + ' ' : '';
    let finalText = '';
    rec.onresult = (e: any) => {
      let inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else inter += r[0].transcript;
      }
      setAllText((before + finalText).trim());
      setInterim(inter);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'language-not-supported' || e.error === 'service-not-allowed') {
        if (server) {
          toast('This phone can’t recognise that language itself – using the server instead.');
          switchTo.current = l === 'ne-NP' ? 'auto' : l;
        } else {
          toast(l === 'ne-NP' ? 'This browser can’t recognise Nepali speech. Switch to English, or use the keyboard mic in the text box.' : 'Voice is not supported here – use the keyboard mic.', true);
        }
      } else if (e.error === 'not-allowed') {
        toast('Microphone permission is blocked. Allow it in the browser settings.', true);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast(
          e.error === 'network'
            ? 'Voice needs an internet connection. Check your signal and try again, or type the order.'
            : e.error === 'audio-capture'
              ? 'No microphone found. Check that nothing else is using it, or type the order.'
              : 'Voice stopped unexpectedly. Tap the mic to try again, or type the order.',
          true,
        );
      }
    };
    rec.onend = () => {
      setInterim('');
      const next = switchTo.current;
      switchTo.current = null;
      if (next) {
        void begin(next);
        return;
      }
      setRecording(false);
      if (textRef.current.trim()) onText(textRef.current.trim());
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  async function begin(l: Lang) {
    const eff: Lang = l === 'auto' && !server ? 'ne-NP' : l;
    try {
      if (useBrowserFor(eff)) startBrowser(eff);
      else if (server) await startServerRecording(eff);
      else {
        setRecording(false);
        toast('Voice is not available in this browser. Tap the text box and use your keyboard’s mic button.', true);
      }
    } catch (e) {
      toast((e as Error).message, true);
      setRecording(false);
    }
  }

  const options: { value: Lang; label: string }[] = [
    { value: 'ne-NP', label: 'नेपाली' },
    { value: 'en-US', label: 'English' },
    ...(server ? [{ value: 'auto' as Lang, label: 'Auto / mixed' }] : []),
  ];

  return (
    <div className="card stack">
      <div>
        <div className="strong">Speak the order</div>
        <div className="tiny muted">Nepali, English or both – switch any time, even while talking. e.g. {EXAMPLES[effectiveLang]}</div>
      </div>
      <Seg value={effectiveLang} onChange={setLang} options={options} />
      <button type="button" className={`voice-btn ${recording ? 'rec' : ''}`} onClick={() => (recording ? stop() : begin(effectiveLang))} aria-label={recording ? 'Stop recording' : 'Start speaking'} disabled={busy}>
        <Icon name={recording ? 'x' : 'mic'} size={30} />
      </button>
      <div className="center tiny muted">{recording ? `Listening (${options.find((o) => o.value === effectiveLang)?.label})… tap to stop` : interim || 'Tap the mic and speak'}</div>
      <textarea className="input" placeholder="…or type / use the keyboard mic here" value={recording && interim ? `${text} ${interim}` : text} onChange={(e) => setAllText(e.target.value)} rows={3} />
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setAllText('')} disabled={!text}>
          Clear
        </button>
        <button type="button" className="btn primary" onClick={() => onText(text.trim())} disabled={!text.trim() || busy}>
          {busy ? 'Reading…' : 'Fill the form'}
        </button>
      </div>
    </div>
  );
}
