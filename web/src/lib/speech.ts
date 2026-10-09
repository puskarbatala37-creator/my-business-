import { api } from './api';
import { isIOS } from './pwa';

/** Speech languages offered. Nepali is the default; the choice is remembered on the phone. */
export type SpeechLang = 'ne-NP' | 'en-US';

/** Looked up each time: the browser may provide it only after the page has loaded. */
const recognition = (): any => (typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : undefined);

export function savedLang(): SpeechLang {
  try {
    return localStorage.getItem('slay.voiceLang') === 'en-US' ? 'en-US' : 'ne-NP';
  } catch {
    return 'ne-NP';
  }
}
export function saveLang(l: SpeechLang) {
  try {
    localStorage.setItem('slay.voiceLang', l);
  } catch {}
}

/** Longest a single value is listened for when the server does the speech-to-text. */
const MAX_RECORD_MS = 7000;

export interface Listening {
  /** The words heard, once the person stops speaking. "" if nothing was heard. */
  result: Promise<string>;
  /** Stop listening now and use what was heard so far. */
  finish: () => void;
  /** Stop and discard. */
  cancel: () => void;
}

/**
 * Listens for ONE short value (a date, a size, a name…). The phone's own speech recognition is
 * used where it understands the language (Chrome on Android does Nepali); iPhones send the short
 * recording to the server's speech-to-text for Nepali when it is set up.
 */
export function listenOnce(lang: SpeechLang, serverTranscription: boolean, onInterim: (text: string) => void): Listening {
  const useBrowser = !!recognition() && !(isIOS && serverTranscription && lang === 'ne-NP');
  if (useBrowser) return browserListen(lang, onInterim);
  if (serverTranscription && typeof MediaRecorder !== 'undefined') return serverListen(lang, onInterim);
  const err = new Error('Voice isn’t available in this browser. Type it instead, or use the mic key on your keyboard.');
  return { result: Promise.reject(err), finish: () => {}, cancel: () => {} };
}

function browserListen(lang: SpeechLang, onInterim: (t: string) => void): Listening {
  const Recognition = recognition();
  const rec = new Recognition();
  rec.lang = lang;
  rec.continuous = false; // one value: stop at the first pause
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  let cancelled = false;
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e: any) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
    };
    rec.onerror = (e: any) => {
      if (cancelled || e.error === 'aborted' || e.error === 'no-speech') return;
      reject(
        new Error(
          e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'Slay isn’t allowed to use the microphone. Allow it in your phone’s settings for this app or browser.'
            : e.error === 'language-not-supported'
              ? lang === 'ne-NP'
                ? 'This phone can’t recognise Nepali speech. Switch to English below, or type it.'
                : 'This phone can’t recognise speech in this language. Type it instead.'
              : e.error === 'network'
                ? 'Voice needs an internet connection. Check your signal and try again.'
                : e.error === 'audio-capture'
                  ? 'No microphone found. Check that nothing else is using it.'
                  : 'Voice stopped unexpectedly. Tap the mic to try again.',
        ),
      );
    };
    rec.onend = () => resolve(cancelled ? '' : (finalText + interim).trim());
  });
  rec.start();
  return {
    result,
    finish: () => rec.stop(),
    cancel: () => {
      cancelled = true;
      rec.abort();
    },
  };
}

function serverListen(lang: SpeechLang, onInterim: (t: string) => void): Listening {
  let recorder: MediaRecorder | null = null;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = (async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {
      throw new Error('Slay isn’t allowed to use the microphone. Allow it in your phone’s settings.');
    });
    const mime = ['audio/mp4', 'audio/webm', 'audio/ogg'].find((t) => (MediaRecorder as any).isTypeSupported?.(t)) ?? '';
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recorder = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start();
    timer = setTimeout(() => rec.state !== 'inactive' && rec.stop(), MAX_RECORD_MS);
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    if (cancelled) return '';
    onInterim('Turning speech into text…');
    const form = new FormData();
    form.append('audio', new Blob(chunks, { type: rec.mimeType || 'audio/mp4' }), 'speech');
    form.append('language', lang.slice(0, 2));
    const res = await api.post<{ text: string }>('/api/voice/transcribe', form);
    return res.text.trim();
  })();
  return {
    result,
    finish: () => recorder && recorder.state !== 'inactive' && recorder.stop(),
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    },
  };
}
