// @ts-check
import { defineConfig, envField, sessionDrivers } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

/**
 * Blog posts get their h1 from frontmatter — a `# Heading` in the body would
 * double the h1 and break the outline (and the prose CSS deliberately styles
 * only h2/h3). Fail the build instead of shipping it.
 */
function remarkNoH1InBlog() {
  return (tree, file) => {
    if (!String(file.path ?? '').includes('src/content/blog')) return;
    for (const node of tree.children ?? []) {
      if (node.type === 'heading' && node.depth === 1) {
        file.fail(
          'Blog posts must not contain a level-1 heading — the title comes from frontmatter. Start at ##.',
        );
      }
    }
  };
}

/** Add scope="col" to header-row th elements in rendered markdown tables. */
function rehypeThScope() {
  const visit = (node) => {
    if (node.tagName === 'thead') {
      for (const row of node.children ?? []) {
        for (const cell of row.children ?? []) {
          if (cell.tagName === 'th') {
            cell.properties = { ...cell.properties, scope: 'col' };
          }
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  return (tree) => visit(tree);
}

export default defineConfig({
  site: 'https://tunnex.io',
  security: {
    checkOrigin: false,
  },
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
    // Minimal sitemap pulled forward from S4.2 (posts must be indexable now);
    // S4.2 inherits and extends (robots.txt, site-wide canonicals, JSON-LD).
    sitemap({
      filter: (page) =>
        ![
          '/styleguide/',
          '/trial/verify/',
          '/trial/approved/',
          '/subscribe/confirm/',
          '/subscribe/confirmed/',
          '/enterprise/thanks/',
          '/404/',
        ].some((path) => page.endsWith(path)) && !page.includes('/blog/tag/'),
    }),
    starlight({
      title: 'Tunnex Docs',
      favicon: '/favicon.svg',
      // The site ships its own branded 404 (src/pages/404.astro).
      disable404Route: true,
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
  markdown: {
    remarkPlugins: [remarkNoH1InBlog],
    rehypePlugins: [rehypeThScope],
  },
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
      // Turnstile widget sitekey. NO default: the deployed value comes from
      // wrangler.toml [vars]; local form work switches to the test PAIR in
      // .dev.vars (see .dev.vars.example).
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({
        context: 'client',
        access: 'public',
      }),
      // Cloudflare Web Analytics beacon token (cookieless). Empty by default —
      // the snippet only ships once the token is set (wrangler.toml [vars] at
      // the S4.4 cutover). No token → no beacon, no broken request.
      PUBLIC_CF_ANALYTICS_TOKEN: envField.string({
        context: 'client',
        access: 'public',
        default: '',
      }),
    },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      exclude: ['zod'],
    },
  },
});
