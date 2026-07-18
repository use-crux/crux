import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { blogSource } from '@/lib/source'
import { getMDXComponents } from '@/mdx-components'
import { AuthorRow, GridCard, TagChip, TypeBadge } from '../_components'
import { BLOG_AUTHORS, formatPostDate } from '../_meta'
import { getPosts, showDrafts } from '../_posts'
import { PostToc, type TocItem } from './_toc'

// Fumadocs TOC titles are ReactNode trees (inline code, emphasis, etc.) —
// flatten to plain text for the rail.
function tocText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(tocText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return tocText((node as { props?: { children?: unknown } }).props?.children)
  }
  return ''
}

export default async function BlogPostPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params
  const page = blogSource.getPage([params.slug])
  if (!page || (!showDrafts && page.data.draft)) notFound()

  const data = await page.data.load()
  const MDX = data.body

  const toc: TocItem[] = (data.toc ?? [])
    .filter((item: { depth: number }) => item.depth === 2)
    .map((item: { url: string; title: unknown }) => ({ id: item.url.slice(1), title: tocText(item.title) }))

  const posts = getPosts()
  const related = posts
    .filter(
      (p) =>
        p.slug !== params.slug &&
        (p.type === page.data.type || p.tags.some((tag) => page.data.tags.includes(tag))),
    )
    .slice(0, 3)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: page.data.title,
    description: page.data.description,
    datePublished: new Date(page.data.date).toISOString(),
    author: page.data.authors.map((id: string) => ({
      '@type': 'Person',
      name: BLOG_AUTHORS[id]?.name ?? id,
    })),
    publisher: { '@type': 'Organization', name: 'Crux', url: 'https://cruxjs.dev' },
    keywords: page.data.tags.join(', '),
    mainEntityOfPage: `https://cruxjs.dev${page.url}`,
    url: `https://cruxjs.dev${page.url}`,
  }

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main className="mx-auto w-full max-w-[1080px] px-8 pb-10 pt-[52px]">
        <Link
          href="/blog"
          className="mb-9 inline-flex items-center gap-2 text-[13px] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          <span className="text-[15px]">←</span> All posts
        </Link>

        <div className="max-w-[760px]">
          <div className="flex flex-wrap items-center gap-3">
            <TypeBadge type={page.data.type} />
            <span className="font-mono text-[11.5px] text-fd-muted-foreground">
              {formatPostDate(page.data.date)}
              {page.data.readTime ? ` · ${page.data.readTime} min read` : ''}
            </span>
            {page.data.draft && (
              <span className="rounded border border-dashed border-fd-border px-2 py-[3px] font-mono text-[10px] uppercase tracking-[0.16em] text-fd-muted-foreground">
                Draft
              </span>
            )}
          </div>
          <h1 className="mt-[18px] text-[42px] font-bold leading-[1.08] tracking-[-0.03em] [text-wrap:pretty]">
            {page.data.title}
          </h1>
          <p className="mt-[18px] text-lg leading-relaxed text-fd-muted-foreground [text-wrap:pretty]">
            {page.data.description}
          </p>
          <div className="mt-6 flex items-center gap-3 border-b border-fd-border pb-8">
            <AuthorRow ids={page.data.authors} withNames size={30} />
            <span className="ml-auto flex gap-1.5">
              {page.data.tags.map((tag: string) => (
                <TagChip key={tag} tag={tag} />
              ))}
            </span>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-16 lg:grid-cols-[1fr_240px]">
          <article className="prose max-w-[720px]">
            <MDX components={getMDXComponents()} />
          </article>
          <div className="hidden lg:block">
            <div className="sticky top-[88px]">
              <PostToc items={toc} />
            </div>
          </div>
        </div>
      </main>

      {related.length > 0 && (
        <div className="border-t border-fd-border">
          <div className="mx-auto w-full max-w-[1060px] px-8 pb-24 pt-14">
            <p className="mb-[18px] font-mono text-[11px] tracking-[0.2em] text-fd-muted-foreground">KEEP READING</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((post) => (
                <GridCard key={post.slug} post={post} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function generateStaticParams() {
  return blogSource.getPages().map((page) => ({ slug: page.slugs.join('/') }))
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params
  const page = blogSource.getPage([params.slug])
  if (!page) notFound()

  const { title, description, date, tags, authors } = page.data

  return {
    title,
    description,
    alternates: {
      canonical: page.url,
      types: { 'application/rss+xml': [{ url: '/blog/rss.xml', title: 'Crux Blog' }] },
    },
    openGraph: {
      title,
      description,
      url: page.url,
      siteName: 'Crux',
      type: 'article',
      publishedTime: new Date(date).toISOString(),
      authors: authors.map((id: string) => BLOG_AUTHORS[id]?.name ?? id),
      tags,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}
