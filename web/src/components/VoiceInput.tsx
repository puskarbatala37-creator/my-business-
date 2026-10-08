import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Seg, useToast } from './ui';

type Lang = 'ne-NP' | 'en-US';

const SpeechRecognitionImpl: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined;
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * Speak the order in Nepali (or English). Uses the phone's speech recognition
 * where it supports Nepali (Chrome on Android), otherwise records audio and
 * sends it to the server's speech-to-text. The text box can also be filled by
 * the keyboard's own mic button (Gboard supports Nepali on Android and iPhone).
 */
export function VoiceInput({ onText, busy }: { onText: (text: string) => void; busy?: boolean }) {
  const toast = useToast();
  const cfg = useQuery({ queryKey: ['voice-config'], queryFn: () => api.get<{ serverTranscription: boolean }>('/api/voice/config'), staleTime: Infinity });
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem('slay.voiceLang') as Lang) || 'ne-NP');
  const [recording, setRecording] = useState(false);
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const recRef = useRef<any>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('slay.voiceLang', lang);
    } catch {}
  }, [lang]);
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const server = !!cfg.data?.serverTranscription;
  // iPhone dictation doesn't support Nepali, so prefer the server there when it's configured.
  const useBrowser = !!SpeechRecognitionImpl && !(isIOS && server && lang === 'ne-NP');

  function stop() {
    recRef.current?.stop();
    if (mediaRef.current && mediaRef.current.state !== 'inactive') mediaRef.current.stop();
  }

  async function startServerRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => (window as any).MediaRecorder?.isTypeSupported?.(t)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const form = new FormData();
      form.append('audio', blob, 'speech');
      form.append('language', lang.slice(0, 2));
      setInterim('Converting speech to text…');
      try {
        const res = await api.post<{ text: string }>('/api/voice/transcribe', form);
        const t = res.text.trim();
        setText((prev) => (prev ? prev + ' ' : '') + t);
        if (t) onText(((text ? text + ' ' : '') + t).trim());
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

  function startBrowser() {
    const rec = new SpeechRecognitionImpl();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = text ? text + ' ' : '';
    rec.onresult = (e: any) => {
      let inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else inter += r[0].transcript;
      }
      setText(finalText.trim());
      setInterim(inter);
    };
    rec.onerror = (e: any) => {
      if (e.error === 'language-not-supported' || e.error === 'service-not-allowed') {
        toast(server ? 'This phone cannot recognise Nepali – recording for the server instead.' : 'Nepali speech is not supported by this browser. Use the keyboard mic (Gboard) in the text box below.', true);
        if (server) void startServerRecording();
      } else if (e.error === 'not-allowed') {
        toast('Microphone permission is blocked. Allow it in the browser settings.', true);
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        toast(`Voice error: ${e.error}`, true);
      }
    };
    rec.onend = () => {
      setRecording(false);
      setInterim('');
      if (finalText.trim()) onText(finalText.trim());
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
  }

  async function toggle() {
    if (recording) return stop();
    try {
      if (useBrowser) startBrowser();
      else if (server) await startServerRecording();
      else toast('Voice is not available in this browser. Tap the text box and use your keyboard’s mic button.', true);
    } catch (e) {
      toast((e as Error).message, true);
      setRecording(false);
    }
  }

  return (
    <div className="card stack">
      <div className="row between">
        <div>
          <div className="strong">Speak the order</div>
          <div className="tiny muted">e.g. “रातो साडी दुई वटा ३५०० रुपैयाँ, एक हजार एडभान्स इसेवा, भोलि डेलिभरी”</div>
        </div>
      </div>
      <Seg value={lang} onChange={setLang} options={[{ value: 'ne-NP', label: 'नेपाली' }, { value: 'en-US', label: 'English' }]} />
      <button type="button" className={`voice-btn ${recording ? 'rec' : ''}`} onClick={toggle} aria-label={recording ? 'Stop recording' : 'Start speaking'} disabled={busy}>
        <Icon name={recording ? 'x' : 'mic'} size={30} />
      </button>
      <div className="center tiny muted">{recording ? 'Listening… tap to stop' : interim || 'Tap the mic and speak'}</div>
      <textarea className="input" lang={lang.slice(0, 2)} placeholder="…or type / use the keyboard mic here" value={recording && interim ? `${text} ${interim}` : text} onChange={(e) => setText(e.target.value)} rows={3} />
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setText('')} disabled={!text}>
          Clear
        </button>
        <button type="button" className="btn primary" onClick={() => onText(text.trim())} disabled={!text.trim() || busy}>
          {busy ? 'Reading…' : 'Fill the form'}
        </button>
      </div>
    </div>
  );
}
