import server from '@astrojs/cloudflare/entrypoints/server';
import { runLifecycle, d1LifecycleStore } from './lib/lifecycle.ts';
import { d1TrialActivationStore } from './lib/trial-issuance.ts';
import { pendingLaunchIssuer, placeholderKeyIssuer } from './lib/issuance.ts';
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
        issuer: mode === 'prelaunch' ? pendingLaunchIssuer() : placeholderKeyIssuer(),
        mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
        mode,
      }),
    );
  },
} satisfies ExportedHandler<Env>;
