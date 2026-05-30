/**
 * Skeleton primitives.
 *
 * Used as Suspense fallbacks and inline loading states. Visual language
 * matches the editorial Quality Workbench: --qw-bg-muted base, no fancy
 * shimmer — a slow opacity pulse (`qw-skeleton`) on a real-shaped block.
 *
 * Two principles:
 *  1. Always reserve the same dimensions as the real content. Skeletons
 *     should prevent layout shift, not announce themselves.
 *  2. Density matches the surface they replace. A row-based list gets a
 *     row-based skeleton; a card grid gets card skeletons.
 */

import type { CSSProperties, ReactNode } from 'react'

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
}

export function Skeleton({
  width = '100%',
  height = 12,
  radius = 4,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`qw-skeleton ${className ?? ''}`}
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: radius,
        background: 'var(--qw-bg-muted)',
        ...style,
      }}
    />
  )
}

/** Multi-line text skeleton — `lines` rows with slight width variation. */
export function SkeletonText({
  lines = 3,
  width = ['100%', '92%', '78%'],
  lineHeight = 12,
  gap = 6,
  className,
}: {
  lines?: number
  width?: ReadonlyArray<number | string> | (number | string)
  lineHeight?: number
  gap?: number
  className?: string
}) {
  const widths = Array.isArray(width) ? width : [width]
  return (
    <div
      aria-hidden
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={lineHeight} width={widths[i % widths.length] ?? '90%'} />
      ))}
    </div>
  )
}

/** Card-shaped placeholder. Header line + body lines. */
export function SkeletonCard({
  title = true,
  bodyLines = 3,
  height,
  className,
  children,
}: {
  title?: boolean
  bodyLines?: number
  height?: number | string
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderRadius: 10,
        padding: '14px 16px',
        height,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {title && <Skeleton width="40%" height={12} />}
      {children ?? <SkeletonText lines={bodyLines} />}
    </div>
  )
}

/** Repeated row placeholder (matches list/table rows). */
export function SkeletonRows({
  rows = 6,
  rowHeight = 36,
  className,
  style,
}: {
  rows?: number
  rowHeight?: number
  className?: string
  style?: CSSProperties
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        background: 'var(--qw-border)',
        border: '1px solid var(--qw-border)',
        borderRadius: 10,
        overflow: 'hidden',
        ...style,
      }}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--qw-bg-elev)',
            height: rowHeight,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            gap: 12,
          }}
        >
          <Skeleton width={12} height={12} radius={3} />
          <Skeleton width="22%" height={10} />
          <Skeleton width="14%" height={10} />
          <Skeleton width="34%" height={10} />
          <Skeleton width="10%" height={10} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

/** KPI strip placeholder — matches the Overview header. */
export function SkeletonKpiStrip({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-hidden
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            background: 'var(--qw-bg-elev)',
            border: '1px solid var(--qw-border)',
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 78,
          }}
        >
          <Skeleton width="50%" height={10} />
          <Skeleton width="70%" height={20} />
          <Skeleton width="35%" height={8} />
        </div>
      ))}
    </div>
  )
}

/** Sidebar tree placeholder — vertical list of indented rows. */
export function SkeletonTree({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingLeft: 6 + (i % 3) * 10,
            height: 22,
          }}
        >
          <Skeleton width={10} height={10} radius={2} />
          <Skeleton width={60 + ((i * 13) % 80)} height={10} />
        </div>
      ))}
    </div>
  )
}

/** Two-column split (sidebar + detail) placeholder. */
export function SkeletonSplit({
  sidebarRows = 12,
  detailLines = 6,
}: {
  sidebarRows?: number
  detailLines?: number
}) {
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: '304px 1fr' }}>
      <aside
        style={{
          borderRight: '1px solid var(--qw-border)',
          background: 'var(--qw-bg)',
        }}
      >
        <div style={{ padding: 12 }}>
          <Skeleton width="100%" height={28} radius={6} />
        </div>
        <SkeletonTree rows={sidebarRows} />
      </aside>
      <div style={{ padding: 32 }}>
        <Skeleton width="40%" height={22} />
        <div style={{ height: 12 }} />
        <Skeleton width="68%" height={12} />
        <div style={{ height: 24 }} />
        <SkeletonCard bodyLines={detailLines} />
        <div style={{ height: 18 }} />
        <SkeletonCard bodyLines={detailLines} />
      </div>
    </div>
  )
}

/** Page-loading placeholder used as the route-level Suspense fallback.
 *
 *  Renders as a `<main>` with the same `qw-page-content` view-transition
 *  name and column-flex layout as `QwShell`, so the persistent sidebar
 *  (mounted at App.tsx) stays put and the page area slides cleanly. */
export function SkeletonPage() {
  return (
    <main
      className="qw-page-content flex h-full min-w-0 flex-1 flex-col overflow-auto"
      style={{ background: 'var(--qw-bg)' }}
    >
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <SkeletonKpiStrip count={4} />
        <div className="grid gap-[18px]" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <SkeletonCard bodyLines={6} />
          <SkeletonCard bodyLines={6} />
        </div>
        <SkeletonRows rows={5} />
      </div>
    </main>
  )
}
