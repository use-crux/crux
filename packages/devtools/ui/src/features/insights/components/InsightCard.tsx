import { useMemo, useState } from 'react'
import { Btn, Chip, Sparkline, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import { QwTooltip } from '@/qw/shell/QwTooltip'
import { QwConfirm } from '@/qw/shell/QwConfirm'
import { useNavigation } from '@/app/navigation/useNavigation'
import { SEV_LABEL, SEV_TONE, timeAgo } from '@/features/insights/lib/insight-format'
import type { QualityInsightRecord, QualityRunRecord } from '@/types'

/** What the insight is about — drives the kind chip + the primary action. */
type InsightKind = 'experiment' | 'cassette' | 'baseline' | 'source' | 'insight'

const KIND_ICON: Record<InsightKind, IconName> = {
  experiment: 'flask',
  cassette: 'cassette',
  baseline: 'bookmark',
  source: 'doc',
  insight: 'sparkle',
}

function insightKind(ins: QualityInsightRecord): InsightKind {
  if (ins.linkedExperimentIds?.length) return 'experiment'
  if (ins.linkedCassettePaths?.length) return 'cassette'
  if (ins.linkedDefinitionIds?.length) return 'baseline'
  if (ins.linkedSources?.length) return 'source'
  return 'insight'
}

export function InsightCard({
  ins,
  traceLookup,
  onResolve,
  onSilencePattern,
  onSaveAsCases,
  onRunVariantForTrace,
  onCompareBaselineForTrace,
}: {
  ins: QualityInsightRecord
  traceLookup: ReadonlyMap<string, QualityRunRecord>
  onResolve: () => void
  onSilencePattern: () => void
  onSaveAsCases: () => void
  onRunVariantForTrace: (traceId: string) => void
  onCompareBaselineForTrace: (traceId: string) => void
}) {
  const { navigate } = useNavigation()
  const stripeColor =
    ins.severity === 'high' ? 'var(--qw-danger)' : ins.severity === 'medium' ? 'var(--qw-warn)' : 'var(--qw-iris)'

  const kind = insightKind(ins)
  const linkedTraceIds = ins.linkedTraceIds ?? []
  const linkedCount = linkedTraceIds.length
  const occurrenceCount = ins.occurrenceCount || linkedCount
  const [expanded, setExpanded] = useState(linkedCount === 1)

  const occurrenceTargets = useMemo(() => {
    const set = new Set<string>()
    for (const id of linkedTraceIds) {
      const t = traceLookup.get(id)?.targetId
      if (t) set.add(t)
    }
    if (ins.targetId) set.add(ins.targetId)
    return Array.from(set)
  }, [linkedTraceIds, traceLookup, ins.targetId])

  return (
    <div
      className="grid gap-6 rounded-[10px] px-[22px] py-[18px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        borderLeft: `3px solid ${stripeColor}`,
        gridTemplateColumns: '1fr 240px',
      }}
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Chip tone={SEV_TONE[ins.severity]} dot>
            {SEV_LABEL[ins.severity]}
          </Chip>
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px]"
            style={{ color: 'var(--qw-fg-muted)' }}
          >
            <Icon name={KIND_ICON[kind]} size={12} color="var(--qw-fg-muted)" />
            {kind}
          </span>
          {ins.tags.map((t) => (
            <Chip key={t} tone="muted">
              {t}
            </Chip>
          ))}
          {occurrenceTargets.length === 1 && (
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              target · {occurrenceTargets[0]}
            </span>
          )}
          {occurrenceTargets.length > 1 && (
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {occurrenceTargets.length} targets
            </span>
          )}
          {occurrenceCount > 0 && (
            <Chip tone="crux" mono>
              {occurrenceCount} occurrence{occurrenceCount === 1 ? '' : 's'}
            </Chip>
          )}
          {ins.reopenedAt && (
            <Chip
              tone="warn"
              mono
              title={
                ins.previousResolutionAt
                  ? `Previously resolved ${timeAgo(ins.previousResolutionAt)} — issue returned`
                  : 'Auto-reopened: occurrenceCount grew past the resolved snapshot'
              }
            >
              Reopened · {timeAgo(ins.reopenedAt)}
            </Chip>
          )}
          <span className="ml-auto font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {timeAgo(ins.updatedAt)}
          </span>
        </div>
        <h3 className="m-0 mb-1.5 text-[17px] font-semibold tracking-[-0.012em] leading-[1.3]">{ins.title}</h3>
        <p className="m-0 mb-3 max-w-[680px] text-[13.5px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)' }}>
          {ins.summary}
        </p>
        {ins.proposedFix && (
          <div
            className="flex max-w-[680px] items-start gap-2 rounded-[6px] px-2.5 py-2 text-[12px]"
            style={{
              background: 'var(--qw-crux-soft)',
              border: '1px dashed var(--qw-crux-line)',
            }}
          >
            <Icon name="sparkle" size={13} color="var(--qw-crux)" />
            <div>
              <span className="mr-1.5 font-semibold" style={{ color: 'var(--qw-crux)' }}>
                Proposed fix
              </span>
              {ins.proposedFix}
            </div>
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {kind === 'experiment' && ins.linkedExperimentIds?.[0] && (
            <Btn
              size="xs"
              variant="soft"
              icon={<Icon name="flask" size={12} />}
              onClick={() => navigate({ view: 'experiment-detail', experimentId: ins.linkedExperimentIds![0] })}
            >
              Open experiment
            </Btn>
          )}
          {kind === 'cassette' && ins.linkedCassettePaths?.[0] && (
            <Btn
              size="xs"
              variant="soft"
              icon={<Icon name="cassette" size={12} />}
              onClick={() => navigate({ view: 'cassettes', path: ins.linkedCassettePaths![0] })}
            >
              Re-record cassette
            </Btn>
          )}
          {kind === 'baseline' && (
            <Btn size="xs" variant="soft" icon={<Icon name="bookmark" size={12} />} onClick={() => navigate({ view: 'baselines' })}>
              Review baseline
            </Btn>
          )}
          {linkedCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[5px] font-mono text-[11.5px] transition-colors hover:opacity-90"
              style={{
                background: 'var(--qw-bg-muted)',
                color: 'var(--qw-fg)',
                border: '1px solid var(--qw-border)',
              }}
              title={linkedCount === 1 ? 'View occurrence' : `${expanded ? 'Hide' : 'Show'} ${linkedCount} occurrences`}
            >
              <Icon name={expanded ? 'arrowDown' : 'arrowRight'} size={11} color="var(--qw-crux)" />
              {linkedCount} occurrence{linkedCount === 1 ? '' : 's'}
            </button>
          )}
          {linkedCount > 0 && (
            <Btn size="xs" icon={<Icon name="layers" size={12} />} onClick={onSaveAsCases}>
              {linkedCount === 1 ? 'Save as case' : `Save ${linkedCount} as cases`}
            </Btn>
          )}
          <QwTooltip content="Mark as fixed. Auto-reopens if more occurrences are detected.">
            <Btn size="xs" icon={<Icon name="check" size={12} />} onClick={onResolve}>
              Resolve
            </Btn>
          </QwTooltip>
          <QwConfirm
            title={`Silence "${ins.title}"?`}
            description={
              <>
                Future insights matching <strong>{ins.title}</strong>
                {ins.targetId ? (
                  <>
                    {' '}
                    on <strong>{ins.targetId}</strong>
                  </>
                ) : (
                  ' across all targets'
                )}{' '}
                will be hidden from the feed. You can unsilence them at any time from the silences strip above.
              </>
            }
            confirmLabel="Silence pattern"
            tone="warn"
            tooltip={`Hide all "${ins.title}"${
              ins.targetId ? ` on ${ins.targetId}` : ''
            } insights going forward · reversible from the silences strip`}
            onConfirm={onSilencePattern}
          >
            <Btn size="xs" icon={<Icon name="x" size={12} />}>
              Silence pattern
            </Btn>
          </QwConfirm>
        </div>

        {expanded && linkedCount > 0 && (
          <div className="mt-3 overflow-hidden rounded-[6px]" style={{ border: '1px solid var(--qw-border)' }}>
            <div
              className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{
                color: 'var(--qw-fg-faint)',
                background: 'var(--qw-bg-muted)',
                borderBottom: '1px solid var(--qw-border)',
              }}
            >
              Occurrences · {linkedCount}
              {occurrenceCount > linkedCount && (
                <span style={{ textTransform: 'none', marginLeft: 8 }}>
                  ({occurrenceCount} total — backend returned first {linkedCount})
                </span>
              )}
            </div>
            <div className="flex flex-col" style={{ background: 'var(--qw-bg)' }}>
              {linkedTraceIds.slice(0, 5).map((traceId) => (
                <OccurrenceRow
                  key={traceId}
                  traceId={traceId}
                  run={traceLookup.get(traceId)}
                  onRunVariant={() => onRunVariantForTrace(traceId)}
                  onCompareBaseline={() => onCompareBaselineForTrace(traceId)}
                />
              ))}
              {linkedTraceIds.length > 5 && (
                <div
                  className="px-3 py-2 font-mono text-[11px]"
                  style={{
                    color: 'var(--qw-fg-muted)',
                    borderTop: '1px solid var(--qw-border)',
                    background: 'var(--qw-bg-muted)',
                  }}
                >
                  + {linkedTraceIds.length - 5} more occurrences ·{' '}
                  <span style={{ color: 'var(--qw-fg-faint)' }}>full pagination pending backend (see #529)</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[10px] font-medium uppercase tracking-[0.16em]" style={{ color: 'var(--qw-fg-faint)' }}>
          Trend
        </div>
        <div
          className="rounded-[6px] px-3 py-2.5"
          style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
        >
          {ins.trend && ins.trend.length > 1 ? (
            <Sparkline data={ins.trend} width={216} height={48} />
          ) : (
            <div className="text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              No trend recorded yet.
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <div
            className="flex-1 rounded-[6px] px-2.5 py-1.5"
            style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
          >
            <div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
              Occurrences
            </div>
            <div className="font-mono text-[16px] font-semibold">{occurrenceCount}</div>
            {occurrenceCount > linkedCount && (
              <div className="text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {linkedCount} linked
              </div>
            )}
          </div>
          <div
            className="flex-1 rounded-[6px] px-2.5 py-1.5"
            style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
          >
            <div className="text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
              Severity
            </div>
            <div className="mt-0.5 text-[12px] font-medium">{SEV_LABEL[ins.severity]}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function OccurrenceRow({
  traceId,
  run,
  onRunVariant,
  onCompareBaseline,
}: {
  traceId: string
  run: QualityRunRecord | undefined
  onRunVariant: () => void
  onCompareBaseline: () => void
}) {
  const { navigate } = useNavigation()
  const shortId = traceId.length > 8 ? `${traceId.slice(0, 4)}…${traceId.slice(-2)}` : traceId
  const startedAt = run?.startedAt
  const target = run?.targetId
  const status = run?.status
  const dur = run?.durationMs
  const statusTone: ChipTone =
    status === 'success' || status === 'ok'
      ? 'ok'
      : status === 'running'
        ? 'crux'
        : status === 'error' || status === 'failed'
          ? 'danger'
          : status === 'suspended'
            ? 'iris'
            : 'muted'
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 text-[12px]"
      style={{
        gridTemplateColumns: '76px 70px 70px 1fr auto',
        borderBottom: '1px solid var(--qw-border)',
      }}
    >
      <button
        type="button"
        onClick={() => navigate({ view: 'run-detail', traceId })}
        className="truncate text-left font-mono text-[11.5px] transition-colors hover:underline"
        style={{ color: 'var(--qw-crux)' }}
        title={traceId}
      >
        {shortId}
      </button>
      <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
        {startedAt ? timeAgo(new Date(startedAt).toISOString()) : '—'}
      </span>
      <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {dur != null ? (dur < 1000 ? `${Math.round(dur)}ms` : `${(dur / 1000).toFixed(1)}s`) : '—'}
      </span>
      <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[11px]">
        {status && (
          <Chip tone={statusTone} mono>
            {status}
          </Chip>
        )}
        <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
          {target ?? <span style={{ color: 'var(--qw-fg-faint)' }}>(not in runs cache)</span>}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <QwTooltip content="Open this trace in the Run detail view">
          <Btn
            size="xs"
            icon={<Icon name="trace" size={11} />}
            onClick={() => navigate({ view: 'run-detail', traceId })}
          >
            Open
          </Btn>
        </QwTooltip>
        <QwTooltip content="Re-run this trace with a variant prompt / config">
          <Btn size="xs" icon={<Icon name="play" size={11} />} onClick={onRunVariant}>
            Variant
          </Btn>
        </QwTooltip>
        <QwTooltip content="Compare this trace against the promoted baseline">
          <Btn size="xs" icon={<Icon name="compare" size={11} />} onClick={onCompareBaseline}>
            Compare
          </Btn>
        </QwTooltip>
      </span>
    </div>
  )
}
