import type { KeyboardEvent, MouseEvent } from 'react'
import { usePrefetchRunDetail } from '@/shared/hooks/usePrefetch'
import { Chip, ScoreBadge, type ChipTone } from '@/qw/shell/primitives'
import { RowErrorBoundary } from '@/qw/shell/SectionBoundary'
import { Icon } from '@/qw/shell/Icon'
import { QwTooltip } from '@/qw/shell/QwTooltip'
import { CollapsibleGroup } from '@/qw/shell/FilterPopover'
import type { ColumnId, RunRow } from '../types'
import type { SelectionState } from '../hooks/useRunSelection'
import { COLUMN_DEFS } from '../lib/run-columns'
import { summarizeRunGroup, type RunGroup } from '../lib/run-groups'
import {
  KIND_DOT_COLOR,
  KIND_TONE,
  formatCost,
  formatGraphCounts,
  formatLatency,
  graphCountsTitle,
  isLiveStatus,
  statusTone,
} from '../lib/run-format'

interface RunsTableProps {
  groups: readonly RunGroup[]
  ungrouped: boolean
  gridTemplate: string
  visibleSet: ReadonlySet<ColumnId>
  selected: ReadonlySet<string>
  selectionState: SelectionState
  onToggleAllVisible: () => void
  onToggleSelected: (traceId: string) => void
  onOpenRun: (traceId: string) => void
}

export function RunsTable({
  groups,
  ungrouped,
  gridTemplate,
  visibleSet,
  selected,
  selectionState,
  onToggleAllVisible,
  onToggleSelected,
  onOpenRun,
}: RunsTableProps) {
  const visibleColumns = COLUMN_DEFS.filter((column) => visibleSet.has(column.id))
  const hasRows = groups.some((group) => group.rows.length > 0)

  return (
    <div>
      <div
        className="sticky top-0 z-10 grid items-center gap-2.5 px-8 py-2 text-[10.5px] font-medium uppercase tracking-[0.08em]"
        style={{
          gridTemplateColumns: gridTemplate,
          color: 'var(--qw-fg-faint)',
          background: 'var(--qw-bg)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <SelectAllCheckbox state={selectionState} onToggle={onToggleAllVisible} disabled={!hasRows} />
        {visibleColumns.map((column) => (
          <div key={column.id} className={column.align === 'right' ? 'text-right' : undefined}>
            {column.label}
          </div>
        ))}
      </div>

      {groups.map((group, index) => (
        <RunGroupRows
          key={`g-${index}-${group.key}`}
          group={group}
          ungrouped={ungrouped}
          gridTemplate={gridTemplate}
          visibleSet={visibleSet}
          selected={selected}
          onToggleSelected={onToggleSelected}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  )
}

function RunGroupRows({
  group,
  ungrouped,
  gridTemplate,
  visibleSet,
  selected,
  onToggleSelected,
  onOpenRun,
}: {
  group: RunGroup
  ungrouped: boolean
  gridTemplate: string
  visibleSet: ReadonlySet<ColumnId>
  selected: ReadonlySet<string>
  onToggleSelected: (traceId: string) => void
  onOpenRun: (traceId: string) => void
}) {
  const summary = summarizeRunGroup(group.rows)

  return (
    <CollapsibleGroup
      groupKey={group.key}
      ungrouped={ungrouped}
      title={group.key || '-'}
      count={group.rows.length}
      summary={
        <>
          {summary.failCount > 0 && (
            <Chip tone="danger" mono>
              {summary.failCount} failed
            </Chip>
          )}
          {summary.totalTokens > 0 && (
            <span className="font-mono text-[10.5px]">{summary.totalTokens.toLocaleString()} tok</span>
          )}
          {summary.totalCost > 0 && <span className="font-mono text-[10.5px]">{formatCost(summary.totalCost)}</span>}
          {summary.avgDurationMs != null && (
            <span className="font-mono text-[10.5px]">avg {formatLatency(summary.avgDurationMs)}</span>
          )}
        </>
      }
    >
      {group.rows.length === 0 && (
        <div className="px-8 py-10 text-center text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
          No runs match.
        </div>
      )}
      {group.rows.map((run) => (
        <RowErrorBoundary key={run.id} rowKey={run.id}>
          <RunRowCell
            run={run}
            visibleSet={visibleSet}
            gridTemplate={gridTemplate}
            selected={selected.has(run.traceId)}
            onToggleSelected={() => onToggleSelected(run.traceId)}
            onOpen={() => onOpenRun(run.traceId)}
            traceId={run.traceId}
          />
        </RowErrorBoundary>
      ))}
    </CollapsibleGroup>
  )
}

function RunRowCell({
  run,
  visibleSet,
  gridTemplate,
  selected,
  onToggleSelected,
  onOpen,
  traceId,
}: {
  run: RunRow
  visibleSet: ReadonlySet<ColumnId>
  gridTemplate: string
  selected: boolean
  onToggleSelected: () => void
  onOpen: () => void
  traceId: string
}) {
  const prefetch = usePrefetchRunDetail()
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => prefetch(traceId)}
      onFocus={() => prefetch(traceId)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="grid w-full cursor-pointer items-center gap-2.5 px-8 py-2 text-left text-[12px] transition-colors hover:opacity-90"
      style={{
        gridTemplateColumns: gridTemplate,
        borderBottom: '1px solid var(--qw-border)',
        background: selected ? 'var(--qw-crux-soft)' : undefined,
      }}
    >
      <RowCheckbox
        checked={selected}
        onToggle={(event) => {
          event.stopPropagation()
          onToggleSelected()
        }}
      />
      {COLUMN_DEFS.filter((column) => visibleSet.has(column.id)).map((column) => (
        <RunCell key={column.id} run={run} col={column.id} visibleSet={visibleSet} />
      ))}
    </div>
  )
}

function RowCheckbox({
  checked,
  onToggle,
}: {
  checked: boolean
  onToggle: (event: MouseEvent | KeyboardEvent) => void
}) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onToggle(event)
        }
      }}
      className="flex size-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] transition-colors"
      style={{
        border: `1px solid ${checked ? 'var(--qw-crux)' : 'var(--qw-border-strong)'}`,
        background: checked ? 'var(--qw-crux)' : 'var(--qw-bg)',
      }}
    >
      {checked && <Icon name="check" size={9} color="var(--qw-bg)" />}
    </span>
  )
}

function SelectAllCheckbox({
  state,
  onToggle,
  disabled,
}: {
  state: SelectionState
  onToggle: () => void
  disabled: boolean
}) {
  return (
    <span
      role="checkbox"
      aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => {
        if (!disabled) onToggle()
      }}
      onKeyDown={(event) => {
        if (disabled) return
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="flex size-[14px] flex-shrink-0 cursor-pointer items-center justify-center rounded-[3px] transition-colors"
      style={{
        border: `1px solid ${state !== 'none' ? 'var(--qw-crux)' : 'var(--qw-border-strong)'}`,
        background: state === 'all' ? 'var(--qw-crux)' : state === 'some' ? 'var(--qw-crux-soft)' : 'var(--qw-bg)',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      title={state === 'all' ? 'Deselect all visible' : 'Select all visible'}
    >
      {state === 'all' && <Icon name="check" size={9} color="var(--qw-bg)" />}
      {state === 'some' && <span className="block h-px w-2" style={{ background: 'var(--qw-crux)' }} />}
    </span>
  )
}

/**
 * Run-level diagnostics indicator (⚠ N) shown inline in the target column, so
 * triage can start in the list. Color tracks the max severity; clicking the row
 * still opens the run where the implicated span can be reached.
 */
function DiagnosticsGlyph({ count, severity }: { count: number; severity?: string }) {
  const color = severity === 'error' ? 'var(--qw-danger)' : 'var(--qw-warn)'
  return (
    <QwTooltip content={`${count} diagnostic${count === 1 ? '' : 's'} — open the run to inspect`}>
      <span
        className="ml-auto flex flex-shrink-0 items-center gap-0.5 font-mono text-[9.5px]"
        style={{ color }}
        aria-label={`${count} diagnostics`}
      >
        <Icon name="alert" size={10} color={color} />
        {count}
      </span>
    </QwTooltip>
  )
}

function RunCell({ run, col, visibleSet }: { run: RunRow; col: ColumnId; visibleSet: ReadonlySet<ColumnId> }) {
  switch (col) {
    case 'kind':
      return (
        <Chip tone={KIND_TONE[run.kind]} mono>
          {run.kind}
        </Chip>
      )
    case 'status': {
      const live = isLiveStatus(run.status)
      return (
        <span className="flex min-w-0 items-center gap-1.5">
          {live && (
            <span
              className="size-1.5 flex-shrink-0 animate-pulse rounded-full"
              style={{ background: 'var(--qw-crux)' }}
              aria-hidden
            />
          )}
          <Chip tone={statusTone(run.status)} dot={!live}>
            {run.status}
          </Chip>
        </span>
      )
    }
    case 'trace': {
      const shortId = run.traceId.length > 8 ? `${run.traceId.slice(0, 4)}…${run.traceId.slice(-2)}` : run.traceId
      return (
        <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-crux)' }} title={run.traceId}>
          {shortId}
        </span>
      )
    }
    case 'target': {
      const showSpansInline = !visibleSet.has('spans') && run.childCount != null && run.childCount > 1
      const showSessionInline = !visibleSet.has('session') && Boolean(run.sessionId)
      return (
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11.5px]">
          <QwTooltip content={`Kind: ${run.kind}`}>
            <span
              className="size-[5px] flex-shrink-0 rounded-full"
              style={{ background: KIND_DOT_COLOR[run.kind] }}
              aria-hidden
            />
          </QwTooltip>
          <span className="truncate">{run.target}</span>
          {showSpansInline && (
            <QwTooltip
              content={`Family of ${run.childCount} traces - this row is the rolled-up root. Open to see all spans.`}
            >
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                · {run.childCount} traces
              </span>
            </QwTooltip>
          )}
          {showSessionInline && (
            <QwTooltip content={`session · ${run.sessionId}`}>
              <span
                className="rounded-[3px] px-1 font-mono text-[10px]"
                style={{
                  background: 'var(--qw-bg-muted)',
                  color: 'var(--qw-fg-faint)',
                  border: '1px solid var(--qw-border)',
                }}
              >
                {run.sessionId!.length > 8 ? `${run.sessionId!.slice(0, 8)}…` : run.sessionId}
              </span>
            </QwTooltip>
          )}
          {run.diagnosticsCount != null && run.diagnosticsCount > 0 && (
            <DiagnosticsGlyph count={run.diagnosticsCount} severity={run.diagnosticsMaxSeverity} />
          )}
        </span>
      )
    }
    case 'model':
      return run.model ? (
        <QwTooltip content={run.model}>
          <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {run.model.split('/').pop() ?? run.model}
          </span>
        </QwTooltip>
      ) : (
        <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          -
        </span>
      )
    case 'dur':
      return <span className="text-right font-mono text-[11.5px]">{formatLatency(run.durationMs)}</span>
    case 'tokens':
      return (
        <span className="text-right font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {run.tokenCount != null ? run.tokenCount.toLocaleString() : '-'}
        </span>
      )
    case 'cost':
      return (
        <span className="text-right font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
          {formatCost(run.cost)}
        </span>
      )
    case 'score':
      return (
        <span className="text-right">
          {run.score != null ? (
            <QwTooltip
              content={`Aggregate scorer score (0..1) · tier: ${
                run.score >= 0.85 ? 'ok' : run.score >= 0.7 ? 'crux' : run.score >= 0.55 ? 'warn' : 'danger'
              }`}
            >
              <span style={{ display: 'inline-block' }}>
                <ScoreBadge score={run.score} />
              </span>
            </QwTooltip>
          ) : (
            <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              -
            </span>
          )}
        </span>
      )
    case 'fdbk':
      return (
        <span
          className="text-right font-mono text-[11.5px]"
          style={{ color: run.feedbackCount ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
        >
          {run.feedbackCount || '-'}
        </span>
      )
    case 'provider':
      return run.provider ? (
        <QwTooltip content={run.provider}>
          <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {run.provider}
          </span>
        </QwTooltip>
      ) : (
        <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          -
        </span>
      )
    case 'tools':
      return (
        <span
          className="text-right font-mono text-[11.5px]"
          style={{ color: run.toolCallCount ? 'var(--qw-iris)' : 'var(--qw-fg-faint)' }}
        >
          {run.toolCallCount ?? '-'}
        </span>
      )
    case 'spans':
      return (
        <QwTooltip content={graphCountsTitle(run) || 'No graph rollups'}>
          <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {formatGraphCounts(run)}
          </span>
        </QwTooltip>
      )
    case 'session':
      return run.sessionId ? (
        <QwTooltip content={run.sessionId}>
          <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {run.sessionId.length > 12 ? `${run.sessionId.slice(0, 12)}…` : run.sessionId}
          </span>
        </QwTooltip>
      ) : (
        <span className="truncate font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          -
        </span>
      )
    case 'cassette': {
      const status = run.cassetteStatus
      if (!status) {
        return (
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            -
          </span>
        )
      }
      const tone: ChipTone =
        status === 'recorded' ? 'ok' : status === 'mismatch' ? 'danger' : status === 'missing' ? 'warn' : 'muted'
      return (
        <Chip tone={tone} dot>
          {status}
        </Chip>
      )
    }
    case 'error':
      return (
        <span
          className="truncate font-mono text-[11px]"
          style={{ color: run.errorMessage ? 'var(--qw-danger)' : 'var(--qw-fg-faint)' }}
          title={run.errorMessage ?? ''}
        >
          {run.errorMessage ?? '-'}
        </span>
      )
    case 'time':
      return (
        <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {new Date(run.startedAt).toLocaleTimeString('en-US', { hour12: false })}
        </span>
      )
  }
}
