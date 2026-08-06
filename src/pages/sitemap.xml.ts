import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const prerender = true;

const STATIC_PATHS = [
  '/',
  '/features/',
  '/pricing/',
  '/download/',
  '/security/',
  '/enterprise/',
  '/trial/',
  '/privacy/',
  '/terms/',
  '/blog/',
  '/docs/',
];

export async function generateSitemapXml(baseUrl: string): Promise<string> {
  const publishedBlogPosts = await getCollection('blog', ({ data }) => !data.draft);
  const blogUrls = publishedBlogPosts.map((post) => `${baseUrl}/blog/${post.id}/`);

  const docsEntries = await getCollection('docs');
  const docsUrls = docsEntries
    .map((doc) => doc.id.replace(/\.mdx?$/, ''))
    .filter((id) => id !== 'index' && id !== 'docs/index' && !id.endsWith('/index'))
    .map((id) => {
      const cleanId = id.replace(/^docs\//, '');
      return `${baseUrl}/docs/${cleanId}/`;
    });

  const allUrls = Array.from(
    new Set([...STATIC_PATHS.map((path) => `${baseUrl}${path}`), ...blogUrls, ...docsUrls]),
  ).sort();

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...allUrls.map((url) => `  <url><loc>${url}</loc></url>`),
    '</urlset>',
  ].join('\n');
}

export const GET: APIRoute = async ({ site }) => {
  const baseUrl = (site ?? new URL('https://tunnex.io')).href.replace(/\/$/, '');
  const xml = await generateSitemapXml(baseUrl);

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
  });
};
