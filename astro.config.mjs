// @ts-check
import { defineConfig, envField } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://tunnex.io',
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
      // Full docs skeleton lands in S1.6; a single stub page proves the integration.
      sidebar: [{ label: 'Documentation', autogenerate: { directory: 'docs' } }],
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
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
