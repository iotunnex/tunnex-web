// TEMPORARY (S0.3): unauthenticated smoke endpoint proving the D1 + KV
// bindings respond on a live deployment. Removed once the story report
// captures the evidence — it must not survive into S1.x.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const prerender = false;

const EXPECTED_TABLES = [
  'email_events',
  'enterprise_leads',
  'subscribers',
  'trial_requests',
  'trials',
];

export const GET: APIRoute = async () => {
  const result: {
    ok: boolean;
    d1: { ok: boolean; tables: string[] };
    kv: { ok: boolean };
  } = { ok: false, d1: { ok: false, tables: [] }, kv: { ok: false } };

  try {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    result.d1.tables = results.map((r) => r.name).filter((n) => EXPECTED_TABLES.includes(n));
    result.d1.ok = EXPECTED_TABLES.every((t) => result.d1.tables.includes(t));
  } catch (error) {
    console.log(JSON.stringify({ event: 'smoke.d1_error', message: String(error) }));
  }

  try {
    const key = `smoke:${crypto.randomUUID()}`;
    await env.RATE_LIMIT.put(key, 'ok', { expirationTtl: 60 });
    result.kv.ok = (await env.RATE_LIMIT.get(key)) === 'ok';
    await env.RATE_LIMIT.delete(key);
  } catch (error) {
    console.log(JSON.stringify({ event: 'smoke.kv_error', message: String(error) }));
  }

  result.ok = result.d1.ok && result.kv.ok;
  console.log(JSON.stringify({ event: 'smoke', ...result }));

  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 503,
    headers: { 'content-type': 'application/json' },
  });
};
