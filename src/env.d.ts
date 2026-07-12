// Secrets are set via `wrangler secret put` (prod) / .dev.vars (local), so
// they never appear in wrangler.toml and `wrangler types` cannot see them in
// CI. Declared here so the generated Cloudflare.Env picks them up.
declare namespace Cloudflare {
  interface Env {
    TURNSTILE_SECRET: string;
    /** TEMPORARY (gate 1): gates /api/test-send; removed with the endpoint. */
    TEST_SEND_KEY?: string;
  }
}
