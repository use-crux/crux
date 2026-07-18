import type { Metadata } from 'next'
import { BlogIndex } from './_components'
import { getPosts } from './_posts'

const description =
  'Engineering deep-dives, release notes, and the occasional opinion — from the team building the blocks around the model call.'

export const metadata: Metadata = {
  title: 'Blog',
  description,
  alternates: {
    canonical: '/blog',
    types: { 'application/rss+xml': [{ url: '/blog/rss.xml', title: 'Crux Blog' }] },
  },
  openGraph: {
    title: 'Crux Blog',
    description,
    url: '/blog',
    siteName: 'Crux',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Crux Blog',
    description,
  },
}

export default function BlogPage() {
  const posts = getPosts()

  return (
    <main className="mx-auto w-full max-w-[1060px] px-8 pb-[120px] pt-16">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-[11px] tracking-[0.2em] text-crux">CRUX / BLOG</p>
          <h1 className="mt-3 text-[44px] font-bold leading-[1.05] tracking-[-0.03em]">Notes from the harness</h1>
          <p className="mt-3.5 max-w-[540px] text-base leading-relaxed text-fd-muted-foreground [text-wrap:pretty]">
            Engineering deep-dives, release notes, and the occasional opinion — from the team building the blocks
            around the model call.
          </p>
        </div>
        <a
          href="/blog/rss.xml"
          className="rounded-md border border-fd-border px-3 py-[7px] font-mono text-[11.5px] tracking-[0.08em] text-fd-muted-foreground transition-colors hover:text-fd-foreground"
        >
          RSS ↗
        </a>
      </div>

      <BlogIndex posts={posts} />
    </main>
  )
}
