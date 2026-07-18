import { ImageResponse } from 'next/og'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Crux Blog'

export default function Image() {
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
            'radial-gradient(ellipse 80% 90% at 20% 110%, hsla(192, 45%, 45%, 0.3), transparent 65%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 32, fontWeight: 700 }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" stroke="#e6e6e3" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M12 22V12" stroke="#e6e6e3" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M2 7l10 5 10-5" stroke="#e6e6e3" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
          Crux
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 28, letterSpacing: 6, textTransform: 'uppercase', color: 'hsl(192, 50%, 70%)' }}>
            Blog
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1, letterSpacing: -2 }}>
            Notes from the harness
          </div>
          <div style={{ fontSize: 28, color: '#9ea0a0' }}>cruxjs.dev/blog</div>
        </div>
      </div>
    ),
    size,
  )
}
