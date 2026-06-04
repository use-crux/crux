/**
 * Run-context strip — the thin status + headline-metrics row that sits
 * directly under the app-shell header on the run-detail screen (design
 * `v7-integrated` `RunDetailIntegrated`).
 *
 * In the integrated chrome the standalone `RunHeader` collapses into the
 * shared `QwShell` header (breadcrumb · title · subtitle · actions); this
 * strip carries the run-level facts that must stay visible regardless of
 * the lens or a collapsed inspector: status, the metric strip
 * (duration · tokens · cost · cache · spans) and the diagnostics badge.
 */

import { Icon } from '@/qw/shell/Icon'
import { fmtCost, fmtDuration, fmtTokens } from '@/features/run-detail/lib/span-detail-inspection'
import { StatStrip, StatusPill, type StatItem } from './atoms'

export interface RunContextStripProps {
  status: string
  durationMs?: number
  tokens?: number
  cost?: number
  cacheRead?: number
  spanCount?: number
  diagnosticsCount: number
}

export function RunContextStrip({
  status,
  durationMs,
  tokens,
  cost,
  cacheRead,
  spanCount,
  diagnosticsCount,
}: RunContextStripProps) {
  // A live run shows elapsed time (not a final duration) and an indeterminate
  // progress bar — the run-level "still executing" cue (design `RunLive`).
  const isRunning = status === 'running'
  const items: StatItem[] = [
    { label: isRunning ? 'elapsed' : 'dur', value: fmtDuration(durationMs) },
    { label: 'tokens', value: fmtTokens(tokens) },
    { label: 'cost', value: fmtCost(cost) },
  ]
  if (cacheRead != null) items.push({ label: 'cache', value: fmtTokens(cacheRead), tone: 'ok' })
  if (spanCount != null) items.push({ label: 'spans', value: String(spanCount) })

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
