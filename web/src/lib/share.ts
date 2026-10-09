import { isIOS, isStandalone } from './pwa';

/**
 * Sharing and saving that always does something: the phone's share sheet where available,
 * otherwise copy / download, and as a last resort the caller shows the text to copy by hand.
 */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

const cancelled = (e: unknown) => (e as Error)?.name === 'AbortError';

/** Copies text, also where the Clipboard API is missing or blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {}
    ta.remove();
    return ok;
  }
}

/** Shares text (and a link): share sheet → copy to clipboard. */
export async function shareOrCopy(title: string, text: string, url?: string): Promise<ShareResult> {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (e) {
      if (cancelled(e)) return 'cancelled';
      // Not allowed here (e.g. inside another app's page) – fall back to copying.
    }
  }
  return (await copyText(url ? `${text}\n${url}` : text)) ? 'copied' : 'failed';
}

export const canShareFile = (file: File) => {
  try {
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
};

/** Shares a file (e.g. the invoice PDF to WhatsApp). Returns 'failed' if this phone can't share files. */
export async function shareFile(file: File, title: string, text?: string): Promise<ShareResult> {
  if (!canShareFile(file)) return 'failed';
  try {
    await navigator.share({ files: [file], title, ...(text ? { text } : {}) });
    return 'shared';
  } catch (e) {
    return cancelled(e) ? 'cancelled' : 'failed';
  }
}

/**
 * Saves a file to the phone. Android and computers download it (to Downloads). An iPhone home-screen
 * app can't download directly, so there it opens the share sheet, which has "Save to Files" /
 * "Save Image".
 */
export async function saveFile(file: File): Promise<'saved' | 'shared' | 'cancelled' | 'failed'> {
  if (isIOS && isStandalone() && canShareFile(file)) {
    const r = await shareFile(file, file.name);
    return r === 'shared' ? 'shared' : r === 'cancelled' ? 'cancelled' : 'failed';
  }
  try {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return 'saved';
  } catch {
    return 'failed';
  }
}
