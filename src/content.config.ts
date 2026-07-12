import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// Blog (S3B.1): git-based MD/MDX via Content Collections — PRs are the CMS.
const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string(),
    // lowercase-hyphenated only: tags flow raw into /blog/tag/<tag>/ URLs
    tags: z.array(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)).default([]),
    draft: z.boolean().default(false),
    hero: z.string().optional(),
  }),
});

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  blog,
};
