import { reportNetwork } from './online';

export const OFFLINE_MESSAGE = "You're offline, so this wasn't saved. Try again once you have internet.";

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: {
        ...(method !== 'GET' ? { 'x-slay': '1' } : {}),
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    // No connection (or the server can't be reached).
    reportNetwork(false);
    throw new ApiError(0, method === 'GET' ? "You're offline. This will load once you have internet." : OFFLINE_MESSAGE, 'offline');
  }
  reportNetwork(true);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Not a reply from Slay itself – usually the host while Slay restarts or updates.
    throw new ApiError(res.status || 503, 'Slay’s server isn’t answering right now. Wait a minute and try again.', 'unavailable');
  }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/login')) window.dispatchEvent(new Event('slay:unauthenticated'));
    throw new ApiError(res.status, data?.error ?? 'Something went wrong. Please try again.', data?.code, data?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export function qs(params: Record<string, string | number | undefined | null | false>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
