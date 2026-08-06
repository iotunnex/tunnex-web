import type { APIRoute } from 'astro';

/**
 * Convenience endpoint for crawlers or users requesting /sitemap.xml directly
 * (Google Search Console accepts either /sitemap.xml or /sitemap-index.xml).
 * Fully prerendered as a static asset.
 */
export const prerender = true;

export const GET: APIRoute = () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://tunnex.io/sitemap-0.xml</loc>
  </sitemap>
</sitemapindex>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
  });
};
