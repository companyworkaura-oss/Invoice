import type { ApiErrorBody } from '@invoice/shared';

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error);
    this.status = status;
    this.body = body;
  }
}

/** Thin fetch wrapper: same-origin, cookie session auth, JSON in/out. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart Content-Type (with boundary) — never override it.
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: init?.body && !isFormData ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });
  const body = await res.json().catch(() => ({ error: 'Invalid server response' }));
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody);
  return body as T;
}
