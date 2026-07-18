'use client'

// Blog listing + card components, implementing the "Crux Blog" design:
// typographic block-motif covers, type badges, featured card, filterable grid.

import Link from 'next/link'
import { useState } from 'react'
import { BLOG_AUTHORS, TYPE_HUE, type PostMeta } from './_meta'

export function TypeBadge({ type }: { type: string }) {
  const hue = TYPE_HUE[type] ?? 192
  return (
    <span
      className="blog-type-badge font-mono text-[10px] uppercase tracking-[0.16em] rounded px-2 py-[3px] border"
      style={{ '--hue': hue } as React.CSSProperties}
    >
      {type}
    </span>
  )
}

export function TagChip({ tag }: { tag: string }) {
  return (
    <span className="font-mono text-[10.5px] text-fd-muted-foreground border border-fd-border rounded-full px-2 py-[2px]">
      {tag}
    </span>
  )
}

export function Avatar({ id, size = 26 }: { id: string; size?: number }) {
  const author = BLOG_AUTHORS[id]
  if (!author) return null
  return (
    <span
      title={author.name}
      className="blog-avatar inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[0.02em]"
      style={{ '--hue': author.hue, width: size, height: size, fontSize: size * 0.36 } as React.CSSProperties}
    >
      {author.initials}
    </span>
  )
}

export function AuthorRow({ ids, withNames = false, size = 26 }: { ids: string[]; withNames?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center" style={{ gap: withNames ? 8 : 0 }}>
      <span className="inline-flex">
        {ids.map((id, i) => (
          <span key={id} className="inline-flex" style={{ marginLeft: i ? -8 : 0 }}>
            <Avatar id={id} size={size} />
          </span>
        ))}
      </span>
      {withNames && (
        <span className="text-[13px] text-fd-muted-foreground">
          {ids.map((id) => BLOG_AUTHORS[id]?.name ?? id).join(' · ')}
        </span>
      )}
    </span>
  )
}

// Typographic cover — grid backdrop, hued glow, mono motif line, snap-notch.
export function Cover({ post, height = 220, big = false }: { post: PostMeta; height?: number; big?: boolean }) {
  const hue = TYPE_HUE[post.type] ?? 192
  const motif =
    post.type === 'Release'
      ? `~ ${post.slug.replace(/-/g, '.')}`
      : post.type === 'Engineering'
        ? `fn ${post.tags[0] ?? post.slug}()`
        : post.type === 'Essay'
          ? `// ${post.tags[0] ?? post.slug}`
          : `$ ${post.tags[0] ?? post.slug}`
  return (
    <div
      className="blog-cover relative overflow-hidden rounded-[10px] border border-fd-border bg-fd-card"
      style={{ '--hue': hue, height } as React.CSSProperties}
    >
      <div className="blog-cover-glow absolute inset-0" />
      <div className="absolute left-[18px] top-4 flex gap-1.5">
        {post.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="font-mono text-[9px] uppercase tracking-[0.14em] text-fd-muted-foreground">
            {tag} ·
          </span>
        ))}
      </div>
      <code
        className="blog-cover-motif absolute bottom-4 left-[18px] font-mono font-semibold"
        style={{ fontSize: big ? 22 : 15 }}
      >
        {motif}
      </code>
      {/* Snap-notch — matches the harness tile motif */}
      <div
        className="absolute -top-[3px] right-6 h-1.5 w-4 rounded-b-[5px] border-x border-b border-fd-border"
        style={{ background: 'var(--color-fd-background)' }}
      />
    </div>
  )
}

export function FeaturedCard({ post }: { post: PostMeta }) {
  return (
    <Link
      href={post.url}
      className="group grid cursor-pointer grid-cols-1 items-center gap-10 rounded-[14px] border border-fd-border bg-fd-card p-7 transition-colors hover:border-crux/40 md:grid-cols-[1.1fr_1fr]"
    >
      <div>
        <div className="flex items-center gap-2.5">
          <TypeBadge type={post.type} />
          <span className="font-mono text-[11px] text-fd-muted-foreground">
            {post.dateLabel}
            {post.readTime ? ` · ${post.readTime} min` : ''}
          </span>
        </div>
        <h2 className="mt-4 text-[30px] font-bold leading-[1.15] tracking-[-0.02em]">{post.title}</h2>
        <p className="mt-3 text-[15px] leading-relaxed text-fd-muted-foreground [text-wrap:pretty]">{post.description}</p>
        <div className="mt-5 flex items-center gap-3.5">
          <AuthorRow ids={post.authors} withNames />
          <span className="ml-auto text-[13px] font-semibold text-crux">Read post →</span>
        </div>
      </div>
      <Cover post={post} height={230} big />
    </Link>
  )
}

export function GridCard({ post }: { post: PostMeta }) {
  return (
    <Link
      href={post.url}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl border border-fd-border bg-fd-card transition-colors hover:border-crux/40"
    >
      <div className="p-2.5 pb-0">
        <Cover post={post} height={130} />
      </div>
      <div className="flex flex-1 flex-col gap-2.5 px-[18px] pb-[18px] pt-4">
        <div className="flex items-center gap-2">
          <TypeBadge type={post.type} />
          <span className="font-mono text-[10.5px] text-fd-muted-foreground">{post.dateLabel}</span>
        </div>
        <h3 className="text-[17px] font-semibold leading-[1.3] tracking-[-0.01em] transition-colors group-hover:text-crux">
          {post.title}
        </h3>
        <p className="text-[13px] leading-[1.55] text-fd-muted-foreground [text-wrap:pretty]">{post.description}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <AuthorRow ids={post.authors} size={22} />
          {post.readTime ? <span className="font-mono text-[10.5px] text-fd-muted-foreground">{post.readTime} min</span> : null}
        </div>
      </div>
    </Link>
  )
}

// Listing body: filter chips + featured + grid.
export function BlogIndex({ posts }: { posts: PostMeta[] }) {
  const [filter, setFilter] = useState('All')
  const types = ['All', ...Array.from(new Set(posts.map((p) => p.type)))]
  const visible = posts.filter((p) => filter === 'All' || p.type === filter)
  const featured = filter === 'All' ? visible.find((p) => p.featured) : undefined
  const rest = featured ? visible.filter((p) => p !== featured) : visible

  return (
    <>
      <div className="mb-7 mt-10 flex flex-wrap gap-2 border-b border-fd-border pb-3.5">
        {types.map((type) => {
          const active = filter === type
          const count = type === 'All' ? null : posts.filter((p) => p.type === type).length
          return (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              className={`rounded-full border px-[13px] py-1.5 font-mono text-[11.5px] tracking-[0.06em] transition-colors ${
                active
                  ? 'border-crux/40 bg-crux-soft text-crux'
                  : 'border-fd-border text-fd-muted-foreground hover:border-fd-border hover:text-fd-foreground'
              }`}
            >
              {type}
              {count !== null ? ` · ${count}` : ''}
            </button>
          )
        })}
      </div>

      {featured && (
        <div className="mb-9">
          <FeaturedCard post={featured} />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rest.map((post) => (
          <GridCard key={post.slug} post={post} />
        ))}
      </div>

      {rest.length === 0 && !featured && (
        <p className="py-16 text-center text-sm text-fd-muted-foreground">No posts yet.</p>
      )}
    </>
  )
}
