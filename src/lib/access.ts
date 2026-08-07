/**
 * Cloudflare Access identity, VERIFIED (S12.10).
 *
 * ⛔ THE HEADER IS NOT THE IDENTITY. `Cf-Access-Jwt-Assertion` is a string in a request, and a string in a
 * request is whatever the caller typed. Reading it and believing it is the `middleware.RealIP` shape: a
 * header that is trustworthy ONLY because something upstream sets it, trusted by something that cannot
 * tell whether the upstream was there.
 *
 * ⭐ WHAT MAKES IT AN IDENTITY IS THE SIGNATURE. The assertion is an RS256 JWT signed by the Access team's
 * keys, published at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` (measured live: 2 RSA keys,
 * RS256, kid-selected — two because rotation publishes the next one alongside the current). Verifying it
 * settles the question no matter what order the edge ran things in: an unsigned or forged assertion fails
 * the same way whether Access is in front of this Worker or has been removed from it.
 *
 * ⛔ AND THE `aud` CHECK IS NOT OPTIONAL. Every application in one Access team is signed by the SAME keys,
 * so a valid assertion for any other app on this account would otherwise be accepted here. The audience tag
 * is what binds a token to THIS application.
 *
 * ⚠ FAIL-CLOSED ON CONFIGURATION. Missing team domain or audience means REFUSE, never "fall back to the
 * shared token" — a typo in a variable name must not silently downgrade the only gate in front of the
 * signer to a string that lives in shell history.
 */

export interface AccessIdentity {
  /** The authenticated human. Absent on a service token — see `name`. */
  email: string;
  /** Access's stable subject id for the user. Empty for a service token. */
  sub: string;
  /** What to write in an audit row: the email, or `service-token:<name>`. */
  actor: string;
}

export type AccessResult =
  { ok: true; identity: AccessIdentity } | { ok: false; status: number; reason: string };

interface Jwk {
  kid: string;
  kty: string;
  alg: string;
  n: string;
  e: string;
}

/**
 * JWKS cache. ⚠ Keyed by team domain and bounded by TTL rather than held forever: Access rotates, and a
 * Worker isolate can live long enough to outlast a rotation. A cache miss costs one subrequest.
 */
const jwks = new Map<string, { at: number; keys: Map<string, CryptoKey> }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

async function keysFor(teamDomain: string, now: number): Promise<Map<string, CryptoKey>> {
  const hit = jwks.get(teamDomain);
  if (hit && now - hit.at < JWKS_TTL_MS) return hit.keys;

  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of body.keys ?? []) {
    // ⛔ RS256 ONLY, AND THE ALGORITHM COMES FROM US, NOT FROM THE TOKEN. Taking `alg` from the JWT header
    // is the classic JWT confusion attack — `none`, or HS256 verified against a public key treated as a
    // shared secret. WebCrypto is told what to import and what to verify with; the token gets no say.
    if (k.kty !== 'RSA' || k.alg !== 'RS256') continue;
    keys.set(
      k.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  if (keys.size === 0) throw new Error('jwks contained no usable RS256 keys');
  jwks.set(teamDomain, { at: now, keys });
  return keys;
}

/** ⚠ Returns an ArrayBuffer, not a view: WebCrypto's types reject a Uint8Array over a shared buffer. */
function bytes(s: string): ArrayBuffer {
  return b64urlToBytes(s).slice().buffer as ArrayBuffer;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

export interface AccessEnv {
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /**
   * ⛔ THE LOCAL-DEVELOPMENT ANSWER, AND IT IS ANSWERED HERE RATHER THAN IN A DOC.
   *
   * `wrangler dev` cannot mint an Access assertion — Access is an edge feature and there is no edge in
   * front of localhost — so without this the admin surfaces are unreachable on a developer's machine and
   * the next person to need them invents a worse way in.
   *
   * ⚠ IT IS SET ONLY IN `.dev.vars`, WHICH IS GITIGNORED AND NEVER DEPLOYED. But "nobody will set it in
   * production" is a hope, not a control, so the bypass ALSO requires the request to have arrived on
   * localhost — see `devIdentity`. Two independent conditions, and the second one is not configurable.
   */
  ADMIN_DEV_IDENTITY?: string;
}

/**
 * The dev bypass, and the reason it cannot fire in production.
 *
 * ⛔ THE HOST CHECK IS THE HALF THAT IS NOT A SETTING. Production requests reach this Worker on
 * `tunnex.io` because that is the route they matched; a loopback URL is not something a caller can present
 * to a deployed route. So even a deployment that wrongly carried `ADMIN_DEV_IDENTITY` — a mistake this
 * repo also guards with a config census — could not be talked into using it.
 *
 * ⚠ AND THE VAR ALONE IS NOT ENOUGH, which is what makes this fail-closed rather than fail-open: the
 * default path is refusal, and BOTH conditions must be true to leave it.
 */
function devIdentity(request: Request, env: AccessEnv): AccessIdentity | null {
  const who = (env.ADMIN_DEV_IDENTITY ?? '').trim();
  if (!who) return null;
  const host = new URL(request.url).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]' && host !== '::1')
    return null;
  return { email: who, sub: '', actor: `${who} (local dev)` };
}

/**
 * Verify the Access assertion on a request and return who it says is calling.
 *
 * ⚠ `now` is injectable so expiry can be tested without waiting an hour.
 */
export async function verifyAccess(
  request: Request,
  env: AccessEnv,
  now: number = Date.now(),
): Promise<AccessResult> {
  // ⚠ CHECKED FIRST so a developer is not asked to configure Access against localhost — and it is the ONLY
  // path that does not end in a verified signature, which is why both of its conditions are stated above.
  const dev = devIdentity(request, env);
  if (dev) return { ok: true, identity: dev };

  const team = (env.CF_ACCESS_TEAM_DOMAIN ?? '').trim();
  const aud = (env.CF_ACCESS_AUD ?? '').trim();
  if (!team || !aud) {
    // ⛔ NOT A FALLBACK. A deployment that cannot check identity must not act as the signer for anyone.
    return {
      ok: false,
      status: 503,
      reason:
        'Access identity is not configured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD (the Access ' +
        'application audience tag) in wrangler.toml. Refusing rather than falling back.',
    };
  }

  const token =
    request.headers.get('cf-access-jwt-assertion') ??
    /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  if (!token) {
    return { ok: false, status: 401, reason: 'no Cloudflare Access assertion on this request' };
  }

  const [rawHeader, rawClaims, rawSig] = token.split('.');
  if (!rawHeader || !rawClaims || !rawSig) {
    return { ok: false, status: 401, reason: 'malformed assertion' };
  }

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodeJson(rawHeader);
    claims = decodeJson(rawClaims);
  } catch {
    return { ok: false, status: 401, reason: 'unreadable assertion' };
  }

  let keys: Map<string, CryptoKey>;
  try {
    keys = await keysFor(team, now);
  } catch (e) {
    // ⚠ A JWKS OUTAGE IS A REFUSAL, NOT AN ADMISSION. The signer is the wrong place to degrade open.
    return {
      ok: false,
      status: 503,
      reason: `could not read Access signing keys: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }
  const key = keys.get(String(header.kid ?? ''));
  if (!key) return { ok: false, status: 401, reason: 'assertion signed by an unknown key' };

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    bytes(rawSig),
    new TextEncoder().encode(`${rawHeader}.${rawClaims}`),
  );
  if (!ok) return { ok: false, status: 401, reason: 'assertion signature did not verify' };

  // ⛔ ISSUER AND AUDIENCE, BOTH. The signature proves the TEAM signed it; `iss` proves it is this team's
  // and `aud` proves it was minted for THIS application rather than any other app on the same account.
  if (String(claims.iss ?? '') !== `https://${team}`) {
    return { ok: false, status: 401, reason: 'assertion issued by a different Access team' };
  }
  const audience = Array.isArray(claims.aud)
    ? (claims.aud as string[])
    : [String(claims.aud ?? '')];
  if (!audience.includes(aud)) {
    return { ok: false, status: 401, reason: 'assertion is for a different Access application' };
  }

  const exp = Number(claims.exp ?? 0) * 1000;
  const nbf = Number(claims.nbf ?? 0) * 1000;
  if (!exp || exp <= now) return { ok: false, status: 401, reason: 'assertion expired' };
  if (nbf && nbf > now + 60_000)
    return { ok: false, status: 401, reason: 'assertion not yet valid' };

  const email = String(claims.email ?? '');
  const sub = String(claims.sub ?? '');
  // ⚠ A SERVICE TOKEN CARRIES NO EMAIL. Access mints one with `common_name` instead, and an audit row
  // saying "" would be worse than one saying which token acted — attribution to a named non-human beats a
  // blank where a person should be (the same rule the control plane's actor_system column follows).
  const common = String(claims.common_name ?? '');
  if (!email && !common) {
    return { ok: false, status: 401, reason: 'assertion carries no identity' };
  }
  return {
    ok: true,
    identity: { email, sub, actor: email || `service-token:${common}` },
  };
}
