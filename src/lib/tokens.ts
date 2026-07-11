/**
 * Token discipline (locked): 32 bytes random, base64url on the wire,
 * sha256-hashed at rest, single-use via atomic consume. The raw token exists
 * only in the emailed link. Expiry is two-tier: security-sensitive links
 * (trial verify) 30 minutes; list-consent links (newsletter confirm) 24 hours.
 */

export const TRIAL_TOKEN_TTL_SECONDS = 30 * 60;
export const NEWSLETTER_TOKEN_TTL_SECONDS = 24 * 60 * 60;

export interface MintedToken {
  /** Goes into the emailed link. Never stored, never logged. */
  raw: string;
  /** sha256 hex of the raw token — the only thing stored. */
  hash: string;
}

export async function mintToken(): Promise<MintedToken> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const raw = base64url(bytes);
  return { raw, hash: await hashToken(raw) };
}

export async function hashToken(raw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
