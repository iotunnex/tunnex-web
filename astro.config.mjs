// @ts-check
import { defineConfig, envField, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://tunnex.io',
  // Astro sessions are unused (no site login). Without this, the Cloudflare
  // adapter auto-injects a SESSION KV binding into the deployed Worker config —
  // no dangling expected-but-unused bindings allowed.
  session: { driver: sessionDrivers.null() },
  adapter: cloudflare({
    // sharp is unavailable in the Workers runtime; optimize images at build time.
    imageService: 'compile',
    platformProxy: {
      enabled: true,
    },
  }),
  integrations: [
    starlight({
      title: 'Tunnex Docs',
      favicon: '/favicon.svg',
      description:
        'Tunnex documentation — install, configure, and operate your self-hosted Zero Trust VPN.',
      customCss: ['./src/styles/starlight.css'],
      components: { SiteTitle: './src/components/starlight/SiteTitle.astro' },
      head: [
        {
          tag: 'script',
          // Dark-first parity with the marketing pages: adopt their stored
          // choice; otherwise default docs to dark instead of Starlight's auto.
          content: `
            if (!localStorage.getItem('starlight-theme')) {
              const t = localStorage.getItem('theme');
              localStorage.setItem('starlight-theme', t === 'light' ? 'light' : 'dark');
            }
          `,
        },
      ],
      sidebar: [{ label: 'Documentation', items: [{ autogenerate: { directory: 'docs' } }] }],
    }),
  ],
  env: {
    schema: {
      // prelaunch | beta — runtime value comes from wrangler.toml [vars];
      // prerendered pages bake in the build-time value (default below or .env).
      LAUNCH_MODE: envField.enum({
        values: ['prelaunch', 'beta'],
        context: 'server',
        access: 'public',
        default: 'prelaunch',
      }),
      // Enterprise price presentation on /pricing — see src/config.ts.
      ENTERPRISE_PRICING: envField.enum({
        values: ['contact', 'indicative'],
        context: 'server',
        access: 'public',
        default: 'contact',
      }),
      // Base URL for release artifacts (R2 at dl.tunnex.io — EPIC 5).
      DOWNLOAD_BASE_URL: envField.string({
        context: 'server',
        access: 'public',
        default: 'https://dl.tunnex.io',
      }),
      // Base for links/assets inside outbound emails. Flips to
      // https://tunnex.io in the S4.4 launch runbook.
      EMAIL_LINK_BASE_URL: envField.string({
        context: 'server',
        access: 'public',
        default: 'https://tunnex-site.iotunnex.workers.dev',
      }),
      // Turnstile widget sitekey. Default is Cloudflare's official visible
      // TEST key (always passes) — production keys land via the S4.4 runbook.
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
        default: '1x00000000000000000000AA',
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
