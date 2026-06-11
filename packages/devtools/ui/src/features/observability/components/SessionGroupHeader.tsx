import { useState, useEffect, useMemo } from 'react'
import { TraceListRow } from './TraceListRow'
import { FlowGroupHeader } from './FlowGroupHeader'
import { Shimmer } from '@/shared/components/ai-elements/shimmer'
import { fmt } from '@/shared/components/ui-atoms'
import {
  formatTime,
  formatDuration,
  formatCost,
  buildFlowGroups,
  type SessionGroup,
  type TraceAnomalies,
} from '@/features/observability/lib/timeline-helpers'

export function SessionGroupHeader({
  group,
  selectedTraceId,
  selectedFlowId,
  selectedSessionId,
  onSelectTrace,
  onSelectFlow,
  onSelectSession,
  judgeScoreMap,
  anomalies,
  flowNameMap,
  securityByTrace,
}: {
  group: SessionGroup
  selectedTraceId: string | null
  selectedFlowId: string | null
  selectedSessionId: string | null
  onSelectTrace: (traceId: string) => void
  onSelectFlow: (flowId: string) => void
  onSelectSession: (sessionId: string) => void
  judgeScoreMap: Map<string, number>
  anomalies: TraceAnomalies
  flowNameMap?: Map<string, string>
  securityByTrace?: Map<string, number>
}) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = group.isRunning ? '\u25CF' : group.hasError ? '\u2717' : '\u2713'
  const statusColor = group.isRunning ? 'text-(--qw-blue)' : group.hasError ? 'text-(--qw-danger)' : 'text-(--qw-ok)'

  const stepCount = group.traces.filter((t) => t.role === 'agent-step').length
  const generateCount = group.traces.filter((t) => t.role === 'generate').length
  const roleParts: string[] = []
  if (stepCount > 0) roleParts.push(`${stepCount} step${stepCount > 1 ? 's' : ''}`)
  if (generateCount > 0) roleParts.push(`${generateCount} call${generateCount > 1 ? 's' : ''}`)
  const roleSummary = roleParts.join(', ')

  const hasSelectedTrace = group.traces.some((t) => t.traceId === selectedTraceId)
  const hasSelectedFlow = group.traces.some((t) => t.flowId === selectedFlowId)
  const isSessionSelected = selectedSessionId === group.sessionId

  useEffect(() => {
    if ((hasSelectedTrace || hasSelectedFlow || isSessionSelected) && !expanded) setExpanded(true)
  }, [hasSelectedTrace, hasSelectedFlow, isSessionSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  const { flowGroups: sessionFlowGroups, ungrouped: sessionUngrouped } = useMemo(
    () => buildFlowGroups(group.traces, flowNameMap),
    [group.traces, flowNameMap],
  )

  const handleHeaderClick = () => {
    if (expanded && isSessionSelected) {
      setExpanded(false)
      onSelectSession('')
    } else {
      setExpanded(true)
      onSelectSession(group.sessionId)
    }
  }

  return (
    <div
      className={`border border-zinc-800 rounded-lg overflow-hidden ${isSessionSelected ? 'ring-1 ring-zinc-500/50' : hasSelectedTrace || hasSelectedFlow ? 'ring-1 ring-zinc-700' : ''}`}
    >
      <button
        onClick={handleHeaderClick}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-zinc-800/50 transition-colors text-left text-[11px]"
      >
        <svg
          className={`w-3 h-3 text-zinc-500 transition-transform shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className={`font-medium ${statusColor}`}>{statusIcon}</span>
        <span className="text-zinc-500 tabular-nums w-16 shrink-0">{formatTime(group.startedAt)}</span>
        <span className="font-mono text-zinc-200 truncate font-medium">Session</span>
        {roleSummary && <span className="text-zinc-500 text-[10px]">{roleSummary}</span>}
        {sessionFlowGroups.length > 0 && (
          <span className="text-(--qw-iris) text-[10px]">
            {sessionFlowGroups.length} flow
            {sessionFlowGroups.length !== 1 ? 's' : ''}
          </span>
        )}
        <span className={`${statusColor} tabular-nums ml-auto`}>
          {group.isRunning ? (
            <Shimmer as="span" className="text-xs text-(--qw-blue)" duration={2}>
              Running...
            </Shimmer>
          ) : (
            formatDuration(group.totalDurationMs)
          )}
        </span>
        {group.totalTokens > 0 && (
          <span className="text-zinc-600 tabular-nums w-14 text-right">{fmt(group.totalTokens, 'tok')}</span>
        )}
        {group.totalCost > 0 && (
          <span className="text-(--qw-ok) tabular-nums text-[10px]">{formatCost(group.totalCost)}</span>
        )}
        <span className="text-zinc-600 tabular-nums w-8 text-right">{group.traces.length}x</span>
      </button>

      {expanded && (
        <div className="border-t border-zinc-800/50 py-1">
          {sessionFlowGroups.map((flowGroup, idx) => (
            <FlowGroupHeader
              key={flowGroup.flowId}
              group={flowGroup}
              index={idx}
              selectedTraceId={selectedTraceId}
              selectedFlowId={selectedFlowId}
              onSelectTrace={onSelectTrace}
              onSelectFlow={onSelectFlow}
              judgeScoreMap={judgeScoreMap}
              anomalies={anomalies}
              flowNameMap={flowNameMap}
              securityByTrace={securityByTrace}
            />
          ))}

          {sessionUngrouped.map((trace, idx) => {
            const avgCost = trace.promptId ? anomalies.avgCostByPrompt.get(trace.promptId) : undefined
            const costDev = avgCost && trace.result?.cost != null ? (trace.result.cost - avgCost) / avgCost : undefined
            return (
              <TraceListRow
                key={trace.traceId}
                trace={trace}
                isSelected={trace.traceId === selectedTraceId}
                onSelect={onSelectTrace}
                judgeScore={judgeScoreMap.get(trace.traceId)}
                isSlow={trace.durationMs != null && trace.durationMs >= anomalies.durationP90}
                costDeviation={costDev}
                securityCount={securityByTrace?.get(trace.traceId)}
                nestLevel={trace.role === 'resolve' ? 0 : trace.role === 'generate' ? 2 : 1}
                showTreeLines={sessionUngrouped.length > 1}
                isLast={idx === sessionUngrouped.length - 1}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
