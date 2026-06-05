/**
 * Run-context strip — the thin status + headline-metrics row under the
 * app-shell header (design `v7-integrated` `RunDetailIntegrated`).
 *
 * Generic renderer: it shows the status pill, whatever metric `items` it's
 * handed (built per-archetype by `archetypeStrip`), the diagnostics badge,
 * and an indeterminate progress bar while the run is live.
 */

import { Icon } from '@/qw/shell/Icon'
import { StatStrip, StatusPill, type StatItem } from './atoms'

export interface RunContextStripProps {
  status: string
  items: readonly StatItem[]
  diagnosticsCount: number
}

export function RunContextStrip({ status, items, diagnosticsCount }: RunContextStripProps) {
  const isRunning = status === 'running'
  return (
    <div
      className="flex flex-shrink-0 flex-col"
      style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      <div className="flex items-center gap-3.5 px-6 py-2.5">
        <StatusPill status={status} />
        <StatStrip items={items} size={11.5} gap={14} />
        <div className="flex-1" />
        {diagnosticsCount > 0 && (
          <div
            className="flex items-center gap-1.5 rounded-[6px] px-2.5 py-1"
            style={{ background: 'var(--qw-warn-soft)' }}
            title={`${diagnosticsCount} run diagnostic${diagnosticsCount === 1 ? '' : 's'}`}
          >
            <Icon name="alert" size={13} color="var(--qw-warn)" />
            <span className="text-[11px] font-semibold" style={{ color: 'var(--qw-warn)' }}>
              {diagnosticsCount} diagnostic{diagnosticsCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </div>
      {isRunning && <div className="qw-progress-bar" aria-hidden />}
    </div>
  )
}
