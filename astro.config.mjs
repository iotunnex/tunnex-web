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
      description: 'Documentation for Tunnex — self-hosted Zero Trust VPN.',
      customCss: ['./src/styles/starlight.css'],
      head: [
        {
          tag: 'script',
          // Dark-first parity with the marketing pages: adopt their stored
          // choice; otherwise default docs to dark instead of Starlight's auto.
          content: `
            const t = localStorage.getItem('theme');
            if (t === 'light' || t === 'dark') localStorage.setItem('starlight-theme', t);
            else if (!localStorage.getItem('starlight-theme')) localStorage.setItem('starlight-theme', 'dark');
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
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
