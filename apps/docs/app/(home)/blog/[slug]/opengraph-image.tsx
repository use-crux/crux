import { ImageResponse } from 'next/og'
import { blogSource } from '@/lib/source'
import { BLOG_AUTHORS, TYPE_HUE, formatPostDate } from '../_meta'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Crux Blog post'

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = blogSource.getPage([slug])
  const title = page?.data.title ?? 'Crux Blog'
  const type = page?.data.type ?? 'Engineering'
  const hue = TYPE_HUE[type] ?? 192
  const author = page?.data.authors.map((id: string) => BLOG_AUTHORS[id]?.name ?? id).join(', ')
  const date = page ? formatPostDate(page.data.date) : ''

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 72,
          background: '#0a0b0d',
          color: '#e6e6e3',
          fontFamily: 'sans-serif',
          backgroundImage:
            `radial-gradient(ellipse 80% 90% at 20% 110%, hsla(${hue}, 45%, 45%, 0.3), transparent 65%)`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 32, fontWeight: 700 }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="#e6e6e3" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M12 22V12" stroke="#e6e6e3" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M2 7l10 5 10-5" stroke="#e6e6e3" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            Crux
          </div>
          <div
            style={{
              fontSize: 22,
              letterSpacing: 4,
              textTransform: 'uppercase',
              color: `hsl(${hue}, 50%, 70%)`,
              border: `2px solid hsla(${hue}, 45%, 55%, 0.5)`,
              borderRadius: 8,
              padding: '8px 20px',
            }}
          >
            {type}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ fontSize: 64, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2, maxWidth: 1000 }}>
            {title}
          </div>
          <div style={{ display: 'flex', gap: 18, fontSize: 26, color: '#9ea0a0' }}>
            <span>{author}</span>
            <span>·</span>
            <span>{date}</span>
            <span>·</span>
            <span>cruxjs.dev/blog</span>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
