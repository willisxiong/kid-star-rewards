export type ApiResult<T> = { status: number; data: T };

export async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  const data = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, data };
}

let toastTimer = 0;

export function showToast(message: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

export function icon(name: string, filled = false): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = filled ? 'material-symbols-outlined fill' : 'material-symbols-outlined';
  span.textContent = name;
  return span;
}
