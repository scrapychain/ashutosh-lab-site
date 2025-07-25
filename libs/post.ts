// lib/posts.ts
// Markdown loader for ashutosh-lab:
// - Parses frontmatter (title, date, tags, description, draft)
// - Converts MD → HTML with GFM
// - Provides helpers: list, single, adjacent, tags, latest, pagination

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import gfm from 'remark-gfm';
import { cache } from 'react';

const POSTS_DIR = path.join(process.cwd(), 'content/lab');
const IS_PROD = process.env.NODE_ENV === 'production';

export type PostMeta = {
  slug: string;
  title: string;
  date: string;          // ISO 8601
  description?: string;
  draft?: boolean;
  tags?: string[];
};

export type PostData = PostMeta & {
  contentHtml: string;
};

// -------------------------
// Frontmatter validation
// -------------------------
function validateFrontmatter(data: unknown, slug: string): PostMeta {
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid frontmatter in ${slug}`);
  }

  const { title, date, description, draft, tags } = data as Record<string, unknown>;

  if (typeof title !== 'string' || !title.trim()) {
    throw new Error(`Missing/invalid "title" in ${slug}`);
  }
  if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
    throw new Error(`Missing/invalid "date" in ${slug}`);
  }

  let parsedTags: string[] | undefined;
  if (Array.isArray(tags)) {
    parsedTags = tags.filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0,
    );
    if (parsedTags.length === 0) parsedTags = undefined;
  }

  return {
    slug,
    title: title.trim(),
    date: new Date(date).toISOString(),
    description: typeof description === 'string' ? description.trim() : undefined,
    draft: typeof draft === 'boolean' ? draft : false,
    tags: parsedTags,
  };
}

// -------------------------
// Core loader (cached)
// -------------------------
type LoadedItem = { meta: PostMeta; content: string };

const loadAllPosts = cache(async (): Promise<LoadedItem[]> => {
  const files = await fs.readdir(POSTS_DIR);
  const mdFiles = files.filter((f) => f.endsWith('.md'));

  const items = await Promise.all(
    mdFiles.map(async (file) => {
      const slug = file.replace(/\.md$/, '');
      const raw = await fs.readFile(path.join(POSTS_DIR, file), 'utf8');
      const { data, content } = matter(raw);
      const meta = validateFrontmatter(data, slug);
      return { meta, content };
    }),
  );

  return items
    .filter(({ meta }) => (IS_PROD ? !meta.draft : true))
    .sort((a, b) => (a.meta.date < b.meta.date ? 1 : -1));
});

// -------------------------
// Public API
// -------------------------

export async function getAllPostsMeta(): Promise<PostMeta[]> {
  const posts = await loadAllPosts();
  return posts.map((p) => p.meta);
}

export async function getPostBySlug(slug: string): Promise<PostData> {
  const posts = await loadAllPosts();
  const found = posts.find((p) => p.meta.slug === slug);

  if (!found) throw new Error(`Post not found: ${slug}`);
  if (IS_PROD && found.meta.draft) throw new Error('Post not found');

  const processed = await remark().use(gfm).use(remarkHtml).process(found.content);
  const contentHtml = processed.toString();

  return { ...found.meta, contentHtml };
}

export async function getAdjacentPosts(slug: string): Promise<{
  previous: PostMeta | null;
  next: PostMeta | null;
}> {
  const metas = await getAllPostsMeta();
  const i = metas.findIndex((p) => p.slug === slug);

  return {
    previous: i < metas.length - 1 ? metas[i + 1] : null,
    next: i > 0 ? metas[i - 1] : null,
  };
}

export async function getAllSlugs(): Promise<string[]> {
  const metas = await getAllPostsMeta();
  return metas.map((m) => m.slug);
}

export async function getPostsByTag(tag: string): Promise<PostMeta[]> {
  const metas = await getAllPostsMeta();
  return metas.filter((m) => m.tags?.includes(tag));
}

export async function getAllTags(): Promise<string[]> {
  const metas = await getAllPostsMeta();
  const set = new Set<string>();
  metas.forEach((m) => m.tags?.forEach((t) => set.add(t)));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// -------------------------
// NEW Helpers
// -------------------------

/**
 * Get the latest N posts (default 3) for homepage or sidebars.
 */
export async function getLatestPosts(limit = 3): Promise<PostMeta[]> {
  const metas = await getAllPostsMeta();
  return metas.slice(0, limit);
}

/**
 * Paginate posts. Page is 1-based.
 * Returns the slice of posts plus pagination metadata.
 */
export async function getPaginatedPosts(page: number, perPage: number): Promise<{
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  items: PostMeta[];
}> {
  const metas = await getAllPostsMeta();

  const total = metas.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const currentPage = Math.min(Math.max(page, 1), totalPages);

  const start = (currentPage - 1) * perPage;
  const end = start + perPage;
  const items = metas.slice(start, end);

  return {
    page: currentPage,
    perPage,
    total,
    totalPages,
    items,
  };
}
