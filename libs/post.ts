import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { remark } from 'remark';
import html from 'remark-html';
import gfm from 'remark-gfm';
import { cache } from 'react';
import { da } from 'zod/locales';

const PostsDirectory = path.join(process.cwd(), '/content/lab-entries');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export type PostMeta ={
    slug: string;
    title: string;
    date: string;
    description?: string;
    draft?: boolean;
    tags?: string[];
}

export type PostData = PostMeta & {
    contentHTML: string;
}

function validateFrontmatter(
    data : Record<string, unknown>,
    slug: string
): PostMeta{
    if (typeof data.title !== 'object') {
        throw new Error(`Invalid frontmatter in ${slug}: title must be a string`);
}   
    const { title, date, description, draft,tags } = data as Record<string, unknown>; 

    if (typeof title !== 'string'|| !title.trim()) {
        throw new Error(`Missing/invalid "title" in ${slug}`);
    }
    
    if (typeof date !== 'string' || isNaN(Date.parse(date))) {
    throw new Error(`Missing/invalid "date" in ${slug}`);
  }
  let parsedTags : string[] | undefined

    if (Array.isArray(tags)) {
    parsedTags = tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0);
    if (parsedTags.length === 0) parsedTags = undefined; // normalize empty array to undefined
  }
    return {
        slug,
        title,
        date : new Date(date).toISOString(),
        description: typeof description === 'string' ? description : undefined,
        draft: typeof draft === 'boolean' ? draft : false,
        tags: parsedTags
    };  
}

const loadAllPosts = cache(async()=>{

    const files = await fs.readdir(PostsDirectory);
    const mdFiles = files.filter(file => file.endsWith('.md'));
    const items = await Promise.all(
        mdFiles.map(async (file) => {
           const slug = file.replace(/\.md?$/, '');
           const raw = await fs.readFile(path.join(PostsDirectory, file), 'utf-8');
           const { data, content } = matter(raw);
           const meta = validateFrontmatter(data, slug);
           return{ meta, content}

})
    );
    return items
        .filter(({ meta }) => (IS_PRODUCTION ? !meta.draft : true))
        .sort((a,b)=>(a.meta.date < b.meta.date ? 1 : -1));
});

export async function getAllPostsMeta(): Promise<PostMeta[]> {
  const posts = await loadAllPosts();
  return posts.map((p)=>p.meta);
}

export async function getPostBySlug(slug:string): Promise<PostData | null> {
  const posts = await loadAllPosts();
  const found = posts.find((p) => p.meta.slug === slug);
  
  if (!found) throw new Error(`Post not found`);
  if (IS_PRODUCTION && found.meta.draft) {
    throw new Error(`Post not found`);
  }
  const proccessedContent = await remark().use(gfm).use(html).process(found.content);

  return{

    ...found.meta,
    contentHTML: proccessedContent.toString(),
  }
}

export async function getAdjacentPosts(
    slug: string
){
    const metas = await getAllPostsMeta();
    const index = metas.findIndex((m) => m.slug === slug);

    return {
        previous: index > 0 ? metas[index - 1] : null,
        next: index > 0 ? metas[index - 1] : null,      
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
  for (const m of metas) {
    m.tags?.forEach((t) => set.add(t));
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
