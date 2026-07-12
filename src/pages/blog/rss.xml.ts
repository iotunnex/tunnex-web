import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { absolutizeHtml, sortedPublished } from '../../lib/blog.ts';

// Full-content feed. Drafts can never appear: items go through the same
// sortedPublished filter as every page.
export const GET: APIRoute = async (context) => {
  const posts = sortedPublished(await getCollection('blog'));
  return rss({
    title: 'Tunnex Blog',
    description:
      'Engineering notes, release news, and zero-trust networking write-ups from the Tunnex team.',
    site: context.site!,
    trailingSlash: true,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      author: post.data.author,
      categories: post.data.tags,
      content: post.rendered?.html && absolutizeHtml(post.rendered.html, context.site!),
    })),
  });
};
