import { blogSource } from '@/lib/source'
import { formatPostDate, type PostMeta } from './_meta'

// Drafts are visible in dev; set CRUX_BLOG_DRAFTS=1 to preview them in a
// production build. Published posts flip `draft: false` in frontmatter.
export const showDrafts = process.env.NODE_ENV !== 'production' || process.env.CRUX_BLOG_DRAFTS === '1'

export function toMeta(page: ReturnType<typeof blogSource.getPages>[number]): PostMeta {
  return {
    slug: page.slugs.join('/'),
    url: page.url,
    title: page.data.title,
    description: page.data.description ?? '',
    date: page.data.date,
    dateLabel: formatPostDate(page.data.date),
    type: page.data.type,
    tags: page.data.tags,
    authors: page.data.authors,
    readTime: page.data.readTime,
    featured: page.data.featured,
  }
}

export function getPosts(): PostMeta[] {
  return blogSource
    .getPages()
    .filter((page) => showDrafts || !page.data.draft)
    .map(toMeta)
    .sort((a, b) => b.date.localeCompare(a.date))
}
