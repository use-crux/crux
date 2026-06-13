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

/** Failure stepper — `‹ ⚠ n/N ›` that walks the shared selection through the
 *  run's failing spans. Mirrors the keyboard `e` / `⇧E` stepper; works across
 *  every lens because the selection is shared. */
export interface ErrorStepper {
  /** 1-based position of the current selection among failures, or 0 when the
   *  selection isn't itself a failure. */
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
}

export interface RunContextStripProps {
  status: string
  items: readonly StatItem[]
  diagnosticsCount: number
  errorStepper?: ErrorStepper
}

export function RunContextStrip({ status, items, diagnosticsCount, errorStepper }: RunContextStripProps) {
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
        {errorStepper && errorStepper.total > 0 && (
          <div
            className="flex items-center overflow-hidden rounded-[6px]"
            style={{ background: 'var(--qw-danger-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-danger)' }}
            title="next / previous failure · e / ⇧E — selection shared across lenses"
          >
            <button
              type="button"
              onClick={errorStepper.onPrev}
              aria-label="Previous failure"
              className="flex cursor-pointer items-center px-1.5 py-1"
              style={{ borderRight: '1px solid var(--qw-danger)' }}
            >
              <Icon name="arrowRight" size={11} color="var(--qw-danger)" className="rotate-180" />
            </button>
            <span className="flex items-center gap-1.5 px-2 py-0.5">
              <Icon name="alert" size={12} color="var(--qw-danger)" />
              <span className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--qw-danger)' }}>
                {errorStepper.index > 0 ? `${errorStepper.index} / ${errorStepper.total}` : errorStepper.total}
              </span>
            </span>
            <button
              type="button"
              onClick={errorStepper.onNext}
              aria-label="Next failure"
              className="flex cursor-pointer items-center px-1.5 py-1"
              style={{ borderLeft: '1px solid var(--qw-danger)' }}
            >
              <Icon name="arrowRight" size={11} color="var(--qw-danger)" />
            </button>
          </div>
        )}
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
