/**
 * Status minimap (design `dx-workbench` `TriageMinimap`, RUN-DETAIL-SPEC §6/§8).
 *
 * An 8px status-toned strip alongside the structure scroll — orientation only,
 * click to jump. It runs on the **full** span set (not just rendered rows), so
 * a long trace's failures are visible at a glance even while folded. Appears
 * only past a row threshold; layout-inert (absolutely-positioned fill inside a
 * fixed-width wrapper) so its percentage segments can never feed back into the
 * row heights.
 */

import { useMemo } from 'react'
import type { SpanNode } from '@/features/observability/lib/span-tree'

const TONE: Record<SpanNode['status'], string> = {
  success: 'var(--qw-ok)',
  error: 'var(--qw-danger)',
  running: 'var(--qw-blue)',
  stale: 'var(--qw-warn)',
}

interface TriageMinimapProps {
  /** Pre-order status sequence over the whole tree. */
  statuses: readonly SpanNode['status'][]
  /** Top of the viewport as a fraction of scrollable content (0–1). */
  scrollRatio: number
  /** Visible fraction of the content (0–1) — height of the viewport marker. */
  viewportRatio: number
  /** Jump: fraction (0–1) of the span set the user clicked. */
  onJump: (fraction: number) => void
}

export function TriageMinimap({ statuses, scrollRatio, viewportRatio, onJump }: TriageMinimapProps) {
  // Collapse consecutive same-status spans into proportional segments.
  const segments = useMemo(() => {
    const out: { status: SpanNode['status']; count: number }[] = []
    for (const s of statuses) {
      const last = out[out.length - 1]
      if (last && last.status === s) last.count += 1
      else out.push({ status: s, count: 1 })
    }
    return out
  }, [statuses])

  const total = statuses.length || 1

  return (
    <div style={{ width: 8, flexShrink: 0, position: 'relative', minHeight: 120 }}>
      <div
        title="run minimap · status density · click to jump"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const fraction = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
          onJump(fraction)
        }}
        className="absolute inset-0 flex cursor-pointer flex-col overflow-hidden rounded"
        style={{ boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
      >
        {segments.map((seg, i) => (
          <div
            key={i}
            style={{
              height: `${(seg.count / total) * 100}%`,
              background: TONE[seg.status],
              opacity: seg.status === 'stale' ? 0.45 : 0.78,
            }}
          />
        ))}
        {/* Viewport indicator — where the scroll is, proportionally. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 rounded-[3px]"
          style={{
            top: `${Math.min(scrollRatio, 1 - viewportRatio) * 100}%`,
            height: `${Math.max(viewportRatio, 0.04) * 100}%`,
            boxShadow: '0 0 0 1.5px var(--qw-fg)',
            opacity: 0.5,
          }}
        />
      </div>
    </div>
  )
}
