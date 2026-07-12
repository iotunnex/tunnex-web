import { describe, expect, it } from 'vitest';
import {
  allTags,
  formatPostDate,
  isPublished,
  readingTimeMinutes,
  sortedPublished,
} from './blog.ts';

const post = (over: { draft?: boolean; pubDate?: string; tags?: string[] } = {}) => ({
  data: {
    draft: over.draft ?? false,
    pubDate: new Date(over.pubDate ?? '2026-07-01'),
    tags: over.tags ?? [],
  },
});

describe('draft filtering (single choke point for every consumer)', () => {
  it('sortedPublished drops drafts and sorts newest first', () => {
    const posts = [
      post({ pubDate: '2026-01-01' }),
      post({ draft: true, pubDate: '2026-12-31' }),
      post({ pubDate: '2026-06-01' }),
    ];
    const result = sortedPublished(posts);
    expect(result.length).toBe(2);
    expect(result.map((p) => p.data.pubDate.getUTCMonth())).toEqual([5, 0]);
    expect(result.every(isPublished)).toBe(true);
  });

  it('allTags never surfaces a draft-only tag', () => {
    const posts = [
      post({ tags: ['zeta', 'alpha'] }),
      post({ draft: true, tags: ['draft-proof-tag-must-not-exist'] }),
    ];
    expect(allTags(posts)).toEqual(['alpha', 'zeta']);
  });
});

describe('reading time', () => {
  it('220 wpm, minimum 1 minute', () => {
    expect(readingTimeMinutes('a few words only')).toBe(1);
    expect(readingTimeMinutes(Array(221).fill('word').join(' '))).toBe(2);
    expect(readingTimeMinutes('')).toBe(1);
  });
});

describe('date formatting', () => {
  it('UTC long form (no local-timezone off-by-one)', () => {
    expect(formatPostDate(new Date('2026-07-12'))).toBe('July 12, 2026');
  });
});

describe('authoring guards (src/content/blog)', () => {
  it('no post carries a level-1 markdown heading (title comes from frontmatter)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const dir = 'src/content/blog';
    const offenders: string[] = [];
    for (const name of readdirSync(dir).filter((f) => /\.(md|mdx)$/.test(f))) {
      let text = readFileSync(join(dir, name), 'utf8');
      text = text.replace(/^---\n[\s\S]*?\n---\n/, ''); // frontmatter
      text = text.replace(/^```[\s\S]*?^```/gm, ''); // fenced code
      if (/^#\s/m.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
