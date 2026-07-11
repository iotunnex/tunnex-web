import { LAUNCH_MODE, ENTERPRISE_PRICING, DOWNLOAD_BASE_URL } from 'astro:env/server';

/**
 * Site launch mode. Single import point for the flag — flipping the value in
 * wrangler.toml (runtime) / astro.config.mjs default (build) must be the only
 * change needed to switch modes.
 *
 * - `prelaunch`: downloads show coming-soon + waitlist; trial flow ends at
 *   "approved — key arrives at beta"; GitHub links hidden/marked.
 * - `beta`: downloads live; trial flow calls the issuance module.
 */
export type LaunchMode = 'prelaunch' | 'beta';

export const launchMode: LaunchMode = LAUNCH_MODE;

/**
 * Enterprise price presentation on /pricing (decided S1.3 review):
 * - `contact`: "Custom — talk to us", no number (default).
 * - `indicative`: "from {indicativeSeatPrice}/user/month, billed annually".
 * Flipping is config-only: change the var (wrangler.toml / .dev.vars) and,
 * for `indicative`, set the placeholder price below.
 */
export type EnterprisePricing = 'contact' | 'indicative';

export const enterprisePricing: EnterprisePricing = ENTERPRISE_PRICING;

/** Placeholder until real pricing is set — only rendered in `indicative` mode. */
export const indicativeSeatPrice = '$15';

/**
 * Release artifact base (R2 bucket behind dl.tunnex.io — EPIC 5). Download
 * links render only in `beta` mode; artifact filenames are placeholders until
 * the product repo's release CI fixes them.
 */
export const downloadBaseUrl = DOWNLOAD_BASE_URL;
