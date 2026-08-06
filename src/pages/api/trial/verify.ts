import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { processTrialVerify, d1TrialVerifyStore } from '../../../lib/trial-verify.ts';
import { d1TrialActivationStore } from '../../../lib/trial-issuance.ts';
import { pendingLaunchIssuer, placeholderKeyIssuer } from '../../../lib/issuance.ts';
import { createMailer, transportFromEnv } from '../../../lib/email/mailer.ts';
import { emailLinkBaseUrl, launchMode } from '../../../config';

export const prerender = false;

// ⛔ DO NOT SWAP THE REAL SIGNER IN HERE. This comment used to invite exactly that ("replace
// placeholderKeyIssuer() with it — nothing else changes"), and taking that invitation would create the
// defect while looking like following instructions.
//
// WHY: Tunnex verifies licences OFFLINE, so there is NO REVOCATION — a key that is minted is alive until
// its expiry and nothing we do afterwards reaches it. An automated mint is therefore a mistake that
// CANNOT BE TAKEN BACK: a wrong domain, a wrong band, a bug on this path, each becomes a permanent grant.
//
// ⚠ AND THIS IS NOT THE ONLY CALLER. `lifecycle.ts` calls onTrialApproved from the DAILY CRON, unattended,
// in a loop. A real issuer wired at either site mints without a human; wired here it would also mint at
// 03:17 with nobody present.
//
// So the real issuer records into a REVIEW QUEUE and a human signs. That belongs at the Issuer seam, not
// at a call site — see issuance.ts. Reasoning: tunnex platform repo, docs/S12.4-issuance-decisions.md §1.
const issuer = launchMode === 'prelaunch' ? pendingLaunchIssuer() : placeholderKeyIssuer();

export const POST: APIRoute = ({ request }) =>
  processTrialVerify(
    {
      store: d1TrialVerifyStore(env.DB),
      activation: d1TrialActivationStore(env.DB),
      issuer,
      mailer: createMailer({ transport: transportFromEnv(env), baseUrl: emailLinkBaseUrl }),
      rateLimitKv: env.RATE_LIMIT,
    },
    request,
  );
