import { useState, useEffect } from 'react'
import type { Trace } from '@/types'
import { TraceListRow } from './TraceListRow'
import { Shimmer } from '@/shared/components/ai-elements/shimmer'
import { fmt } from '@/shared/components/ui-atoms'
import { formatDuration, formatCost, type FlowGroup, type TraceAnomalies } from '@/features/observability/lib/timeline-helpers'

export const FLOW_ACCENT_COLORS = [
  'border-violet-500/50',
  'border-cyan-500/50',
  'border-amber-500/50',
  'border-emerald-500/50',
  'border-rose-500/50',
  'border-indigo-500/50',
]

export function FlowGroupHeader({
  group,
  index,
  selectedTraceId,
  selectedFlowId,
  onSelectTrace,
  onSelectFlow,
  judgeScoreMap,
  anomalies,
  flowNameMap,
  securityByTrace,
  depth = 0,
}: {
  group: FlowGroup
  index: number
  selectedTraceId: string | null
  selectedFlowId: string | null
  onSelectTrace: (traceId: string) => void
  onSelectFlow: (flowId: string) => void
  judgeScoreMap: Map<string, number>
  anomalies: TraceAnomalies
  flowNameMap?: Map<string, string>
  securityByTrace?: Map<string, number>
  depth?: number
}) {
  const [expanded, setExpanded] = useState(false)

  const statusIcon = group.isRunning ? '\u25CF' : group.hasError ? '\u2717' : '\u2713'
  const statusColor = group.isRunning ? 'text-blue-400' : group.hasError ? 'text-red-400' : 'text-emerald-400'
  const stepLabels = [...group.stepGroups.values()].map((sg) => sg.stepLabel).filter((l) => l !== '_ungrouped')

  const flowName = flowNameMap?.get(group.flowId)
  const hasChildren = group.children.length > 0
  const isChild = depth > 0

  const accentColor = FLOW_ACCENT_COLORS[index % FLOW_ACCENT_COLORS.length]!
  const isFlowSelected = selectedFlowId === group.flowId
  const hasSelectedTrace = group.traces.some((t) => t.traceId === selectedTraceId)

  useEffect(() => {
    if ((hasSelectedTrace || isFlowSelected) && !expanded) setExpanded(true)
  }, [hasSelectedTrace, isFlowSelected]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleHeaderClick = () => {
    if (expanded && isFlowSelected) {
      setExpanded(false)
      onSelectFlow('')
    } else {
      setExpanded(true)
      onSelectFlow(group.flowId)
    }
  }

  const headerBg = isChild ? 'bg-violet-950/20 hover:bg-violet-950/30' : 'hover:bg-zinc-800/30'
  const borderStyle = isChild ? `border-l-2 border-violet-500/30` : `border-l-2 ${accentColor}`
  const wrapperBg = isFlowSelected
    ? 'bg-zinc-900/50 ring-1 ring-zinc-700/50 rounded-r'
    : hasSelectedTrace
      ? 'bg-zinc-900/30'
      : ''

  return (
    <div className={`${borderStyle} ${wrapperBg}`}>
      <button
        onClick={handleHeaderClick}
        className={`w-full flex items-center gap-2 px-3 py-1.5 ${headerBg} transition-colors text-left text-[11px]`}
      >
        <svg
          className={`w-3 h-3 text-zinc-500 transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        {/* Type badge */}
        {isChild ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider bg-violet-900/40 text-violet-400 rounded px-1 py-0.5 shrink-0">
            Sub-flow
          </span>
        ) : hasChildren ? (
          <span className="text-[9px] font-semibold uppercase tracking-wider bg-violet-900/30 text-violet-300 rounded px-1 py-0.5 shrink-0">
            Pipeline
          </span>
        ) : (
          <span className="text-violet-400/70 text-[10px] font-medium shrink-0">Flow</span>
        )}

        {/* Name + steps */}
        {flowName ? (
          <>
            <span className={`font-mono text-[10px] font-medium ${isChild ? 'text-violet-300' : 'text-zinc-200'}`}>
              {flowName}
            </span>
            {stepLabels.length > 0 && (
              <span className="font-mono text-zinc-600 text-[10px] truncate">{stepLabels.join(' \u2192 ')}</span>
            )}
          </>
        ) : (
          <span className="font-mono text-zinc-400 truncate text-[10px]">
            {stepLabels.length > 0
              ? stepLabels.join(' \u2192 ')
              : `${group.traces.length} trace${group.traces.length !== 1 ? 's' : ''}`}
          </span>
        )}

        {hasChildren && (
          <span className="text-[9px] text-violet-400/40 shrink-0">
            {group.children.length} sub-flow
            {group.children.length !== 1 ? 's' : ''}
          </span>
        )}

        <span className={`${statusColor} tabular-nums ml-auto text-[10px]`}>
          {group.isRunning ? (
            <Shimmer as="span" className="text-xs text-blue-400" duration={2}>
              Running...
            </Shimmer>
          ) : (
            formatDuration(group.durationMs)
          )}
        </span>
        {group.totalTokens > 0 && (
          <span className="text-zinc-600 tabular-nums text-[10px]">{fmt(group.totalTokens, 'tok')}</span>
        )}
        {group.totalCost > 0 && (
          <span className="text-emerald-500/70 tabular-nums text-[10px]">{formatCost(group.totalCost)}</span>
        )}
        <span className={`${statusColor} text-[10px]`}>{statusIcon}</span>
      </button>

      {expanded && (
        <div className="pl-2">
          {/* Own steps + traces */}
          {[...group.stepGroups.entries()].map(([stepKey, stepGroup]) => (
            <div key={stepKey}>
              {stepGroup.stepLabel !== '_ungrouped' && (
                <div className="flex items-center gap-2 px-4 py-0.5 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-sm bg-violet-400/50 shrink-0" />
                  <span className="text-violet-300/60 font-mono">{stepGroup.stepLabel}</span>
                  <span className="text-zinc-700">{stepGroup.traces.length}x</span>
                </div>
              )}
              {stepGroup.traces.map((trace, tIdx) => {
                const avgCost = trace.promptId ? anomalies.avgCostByPrompt.get(trace.promptId) : undefined
                const costDev =
                  avgCost && trace.result?.cost != null ? (trace.result.cost - avgCost) / avgCost : undefined
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
                    nestLevel={stepGroup.stepLabel !== '_ungrouped' ? 2 : 1}
                    showTreeLines
                    isLast={tIdx === stepGroup.traces.length - 1}
                  />
                )
              })}
            </div>
          ))}

          {/* Child flows */}
          {group.children.length > 0 && (
            <div className="mt-1 ml-2 mb-1 space-y-1">
              {group.children.map((child, childIdx) => (
                <div
                  key={child.flowId}
                  className="rounded-md border border-violet-800/20 bg-violet-950/10 overflow-hidden"
                >
                  <FlowGroupHeader
                    group={child}
                    index={index + childIdx + 1}
                    selectedTraceId={selectedTraceId}
                    selectedFlowId={selectedFlowId}
                    onSelectTrace={onSelectTrace}
                    onSelectFlow={onSelectFlow}
                    judgeScoreMap={judgeScoreMap}
                    anomalies={anomalies}
                    flowNameMap={flowNameMap}
                    securityByTrace={securityByTrace}
                    depth={depth + 1}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
