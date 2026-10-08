import { api } from './api';

/**
 * Shrinks a phone photo (often 4–12 MB) to ~200–400 KB before upload so saving
 * is fast on mobile data. Falls back to the original file if the browser can't
 * decode it (e.g. HEIC on some Android phones).
 */
export async function compressImage(file: File, maxSide = 1400, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

export async function uploadPhoto(file: File): Promise<string> {
  const blob = await compressImage(file);
  const form = new FormData();
  form.append('file', blob, blob === file ? file.name : 'photo.jpg');
  const res = await api.post<{ path: string }>('/api/uploads', form);
  return res.path;
}
