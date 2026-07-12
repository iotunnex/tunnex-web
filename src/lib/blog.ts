import type { CollectionEntry } from 'astro:content';

/**
 * Blog helpers (S3B.1). Draft filtering is centralized here: every consumer
 * (listing, post pages, tag pages, RSS) goes through publishedPosts so a
 * draft can never leak into the build from a forgotten filter.
 */

export type BlogPost = CollectionEntry<'blog'>;

export function isPublished(post: { data: { draft: boolean } }): boolean {
  return !post.data.draft;
}

/** Published posts, newest first (updatedDate does not affect order). */
export function sortedPublished<T extends { data: { draft: boolean; pubDate: Date } }>(
  posts: T[],
): T[] {
  return posts
    .filter(isPublished)
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime());
}

/** Unique tags across published posts, alphabetical. */
export function allTags(posts: { data: { draft: boolean; tags: string[] } }[]): string[] {
  const tags = new Set<string>();
  for (const post of posts.filter(isPublished)) {
    for (const tag of post.data.tags) tags.add(tag);
  }
  return [...tags].sort();
}

/** ~220 wpm, minimum 1 minute. */
export function readingTimeMinutes(markdown: string): number {
  const words = markdown.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

export function formatPostDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(date);
}
