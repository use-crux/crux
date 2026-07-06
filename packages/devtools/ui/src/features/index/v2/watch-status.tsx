import type { ProjectIndexWatchRunInfo, ProjectIndexWatchStatus } from '@/types'
import { T, toneColor, type Tone } from './tokens'

export interface WatchStatusSummary {
  label: string
  detail?: string
  title: string
  tone: Tone
  pulse: boolean
}

/**
 * Convert backend watch telemetry into a compact, stable header summary.
 *
 * The mapping keeps fidelity over decoration: fallback and stale semantic
 * states win over generic running/ready states so users can see why a save was
 * slower or partial.
 */
export function summarizeProjectIndexWatchStatus(status?: ProjectIndexWatchStatus): WatchStatusSummary | null {
  const run = status?.lastRun
  if (!run) return null
  if (run.fallbackUsed) {
    return {
      label: 'fallback',
      detail: run.fallbackReason,
      title: watchStatusTitle(run),
      tone: 'warn',
      pulse: status?.state === 'fallback' || status?.state === 'running',
    }
  }
  if (run.staleSemanticDropped || run.semanticStatus === 'stale-dropped') {
    return {
      label: 'syntax ready',
      detail: 'semantic superseded',
      title: watchStatusTitle(run),
      tone: 'blue',
      pulse: false,
    }
  }
  if (status?.state === 'running' || run.semanticStatus === 'pending') {
    return {
      label: run.status === 'running' ? 'running' : 'syntax ready',
      detail: watchAffectedLabel(run),
      title: watchStatusTitle(run),
      tone: 'blue',
      pulse: true,
    }
  }
  if (status?.state === 'degraded' || run.semanticStatus === 'degraded') {
    return {
      label: 'degraded',
      detail: watchAffectedLabel(run),
      title: watchStatusTitle(run),
      tone: 'danger',
      pulse: false,
    }
  }
  return {
    label: 'live',
    detail: watchAffectedLabel(run),
    title: watchStatusTitle(run),
    tone: 'ok',
    pulse: false,
  }
}

export function WatchStatus({ status }: { status?: ProjectIndexWatchStatus }) {
  const summary = summarizeProjectIndexWatchStatus(status)
  if (!summary) return null
  const c = toneColor(T, summary.tone)
  return (
    <span
      title={summary.title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 6,
        background: c.soft,
        boxShadow: `inset 0 0 0 1px ${c.line}`,
        fontFamily: T.mono,
        fontSize: 11,
        fontWeight: 500,
        color: c.fg,
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 99,
          background: c.fg,
          animation: summary.pulse ? 'index-pulse 1.4s ease-out infinite' : 'none',
        }}
      />
      <span>watch · {summary.label}</span>
      {summary.detail && (
        <span
          style={{
            display: 'inline-block',
            maxWidth: 220,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            color: T.fgMuted,
          }}
        >
          {summary.detail}
        </span>
      )}
    </span>
  )
}

function watchAffectedLabel(run: ProjectIndexWatchRunInfo): string | undefined {
  if (run.affectedFileCount > 0) {
    return `${run.affectedFileCount} file${run.affectedFileCount === 1 ? '' : 's'}`
  }
  if (run.changedFileCount > 0) {
    return `${run.changedFileCount} changed`
  }
  return undefined
}

function watchStatusTitle(run: ProjectIndexWatchRunInfo): string {
  const parts = [
    `run ${run.runId}`,
    run.planKind,
    run.graphConfidence,
    run.fallbackReason ? `fallback: ${run.fallbackReason}` : undefined,
    `semantic: ${run.semanticStatus}`,
  ].filter((part): part is string => Boolean(part))
  return parts.join(' · ')
}
