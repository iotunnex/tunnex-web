/**
 * Uniform JSON error shape for every API endpoint. Clients only ever see
 * { error: { code, message } } — no stack traces, no internals.
 */

export type ApiErrorCode = 'invalid_request' | 'captcha_failed' | 'rate_limited' | 'internal_error';

export interface ApiError {
  error: { code: ApiErrorCode; message: string };
}

export function jsonError(status: number, code: ApiErrorCode, message: string): Response {
  const body: ApiError = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function jsonOk(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
