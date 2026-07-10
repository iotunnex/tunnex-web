import { LAUNCH_MODE } from 'astro:env/server';

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
