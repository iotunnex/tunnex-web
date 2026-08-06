import server from '@astrojs/cloudflare/entrypoints/server';
import { runLifecycle, d1LifecycleStore } from './lib/lifecycle.ts';
import { d1TrialActivationStore } from './lib/trial-issuance.ts';
import { d1ReviewQueueStore, pendingLaunchIssuer, reviewQueueIssuer } from './lib/issuance.ts';
import { createMailer, transportFromEnv } from './lib/email/mailer.ts';
import { emailLinkBaseUrl } from './config';

/**
 * Custom Worker entry (wrangler.toml `main`): the adapter's fetch handler
 * unchanged, plus the daily lifecycle cron ([triggers] crons).
 *
 * LAUNCH_MODE is read from the runtime env here (not src/config.ts): the
 * astro:env module-scope read bakes the build-time default, and the cron must
 * follow the deployed wrangler.toml [vars] flip like everything else.
 */
export default {
  fetch: server.fetch,
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
          mode === 'prelaunch' ? pendingLaunchIssuer() : reviewQueueIssuer(d1ReviewQueueStore(env.DB)),
        mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
        mode,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
