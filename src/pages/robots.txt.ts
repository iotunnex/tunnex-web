import type { APIRoute } from 'astro';

// S4.2: allow-all with the sitemap pointer. noindex on thin/utility pages is
// handled per-page via <meta robots>; robots.txt only advertises the sitemap.
// Prerendered — fully static, no reason to invoke the Worker per crawl.
export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://tunnex.io')).href.replace(/\/$/, '');
  const body = ['User-agent: *', 'Allow: /', '', `Sitemap: ${base}/sitemap-index.xml`, ''].join(
    '\n',
  );
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
