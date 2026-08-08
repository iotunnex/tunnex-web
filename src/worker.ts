import server from '@astrojs/cloudflare/entrypoints/server';
import { runLifecycle, d1LifecycleStore } from './lib/lifecycle.ts';
import { d1TrialActivationStore } from './lib/trial-issuance.ts';
import { d1ReviewQueueStore, pendingLaunchIssuer, reviewQueueIssuer } from './lib/issuance.ts';
import { createMailer, transportFromEnv } from './lib/email/mailer.ts';
import { runRetention, d1RetentionStore } from './lib/retention.ts';
import { emailLinkBaseUrl } from './config';
import { handleInstallHost, INSTALL_HOST } from './install/handler.ts';

/**
 * Custom Worker entry (wrangler.toml `main`): the adapter's fetch handler
 * unchanged, plus the daily lifecycle cron ([triggers] crons).
 *
 * LAUNCH_MODE is read from the runtime env here (not src/config.ts): the
 * astro:env module-scope read bakes the build-time default, and the cron must
 * follow the deployed wrangler.toml [vars] flip like everything else.
 */
export default {
  /**
   * ⛔ THE INSTALL HOST IS INTERCEPTED BEFORE THE ASTRO ADAPTER EVER SEES THE REQUEST.
   *
   * `get.tunnex.io` serves ONE thing — the installer — and it must never delegate to `server.fetch` for any
   * path, including paths that do not exist. This is not a preference; it is the whole fix.
   *
   * A DNS record and a route went live for a few minutes with no handler at all. `/` fell through to the
   * adapter, matched the marketing homepage route, and returned HTTP 200 `text/html` to a shell:
   * `curl -fsSL https://get.tunnex.io | sh` piped the landing page into `sh`. `/install.sh` was no better —
   * it returned the site's 404 PAGE, which is also HTML and also 200-shaped to a pipe.
   *
   * > ## ⭐ **A HOST WHOSE OUTPUT IS EXECUTED MUST NOT SHARE A FALLBACK WITH A HOST THAT SERVES PAGES.**
   *
   * So the check is on hostname, it is first, and it returns unconditionally. `handleInstallHost` has no
   * null branch by construction — there is nothing it can decline that would land somewhere worse.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).hostname === INSTALL_HOST) {
      return handleInstallHost(request);
    }
    return server.fetch(request, env, ctx);
  },
  async scheduled(_controller, env, ctx) {
    // worker-configuration.d.ts types the var as its current literal value —
    // widen, since the whole point is that the deployed value can flip.
    const mode = (env.LAUNCH_MODE as string) === 'beta' ? 'beta' : 'prelaunch';
    ctx.waitUntil(
      runLifecycle({
        store: d1LifecycleStore(env.DB),
        activation: d1TrialActivationStore(env.DB),
        // ⛔ IN BETA THE CRON DEFERS TO THE REVIEW QUEUE, IT DOES NOT MINT. This is the unattended caller
        // — 03:17 UTC, in a loop over every parked trial — and it is exactly why the human gate lives at
        // the Issuer seam rather than at a call site. reviewQueueIssuer has no signing key and no mint
        // path, so this leg is safe by construction rather than by anyone remembering it exists.
        //
        // (In prelaunch the seam defers to LAUNCH instead: nothing has been promised a key yet.)
        issuer:
          mode === 'prelaunch'
            ? pendingLaunchIssuer()
            : reviewQueueIssuer(d1ReviewQueueStore(env.DB)),
        mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
        mode,
      }),
    );
    // ⛔ RETENTION RUNS ON THE SAME DAILY TICK (S12.6). Separate waitUntil, deliberately: a lifecycle
    // failure must not skip the purge, and a purge failure must not stop a customer's trial email. They
    // share a schedule, not a fate.
    ctx.waitUntil(runRetention(d1RetentionStore(env.DB)));
  },
} satisfies ExportedHandler<Env>;
