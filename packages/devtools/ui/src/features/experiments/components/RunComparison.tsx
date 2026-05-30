import { useMemo, useState } from 'react'
import type { EvalCaseData, EvalRun, FlowCaseData, FlowRun } from '@/types'
import { fmt } from '@/shared/components/ui-atoms'

// ─── Diff types ──────────────────────────────────────────────

export interface CaseDiff {
  status: 'regression' | 'fix' | 'unchanged' | 'new'
  durationDelta?: number
  costDelta?: number
}

export interface RunDiff {
  baselineId: string
  cases: Map<string, CaseDiff>
  regressions: number
  fixes: number
  unchanged: number
  newCases: number
}

// ─── Diff computation ────────────────────────────────────────

export function computeEvalRunDiff(current: EvalCaseData[], baseline: EvalCaseData[], baselineId: string): RunDiff {
  const baseMap = new Map<string, EvalCaseData>()
  for (const c of baseline) baseMap.set(`${c.caseName}:${c.modelId}`, c)

  const cases = new Map<string, CaseDiff>()
  let regressions = 0,
    fixes = 0,
    unchanged = 0,
    newCases = 0

  for (const c of current) {
    const key = `${c.caseName}:${c.modelId}`
    const base = baseMap.get(key)
    if (!base) {
      cases.set(key, { status: 'new' })
      newCases++
    } else if (c.passed && !base.passed) {
      cases.set(key, {
        status: 'fix',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.cost ?? 0) - (base.cost ?? 0),
      })
      fixes++
    } else if (!c.passed && base.passed) {
      cases.set(key, {
        status: 'regression',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.cost ?? 0) - (base.cost ?? 0),
      })
      regressions++
    } else {
      cases.set(key, {
        status: 'unchanged',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.cost ?? 0) - (base.cost ?? 0),
      })
      unchanged++
    }
  }

  return { baselineId, cases, regressions, fixes, unchanged, newCases }
}

export function computeFlowRunDiff(current: FlowCaseData[], baseline: FlowCaseData[], baselineId: string): RunDiff {
  const baseMap = new Map<string, FlowCaseData>()
  for (const c of baseline) baseMap.set(`${c.caseName}:${c.configName}`, c)

  const cases = new Map<string, CaseDiff>()
  let regressions = 0,
    fixes = 0,
    unchanged = 0,
    newCases = 0

  for (const c of current) {
    const key = `${c.caseName}:${c.configName}`
    const base = baseMap.get(key)
    if (!base) {
      cases.set(key, { status: 'new' })
      newCases++
    } else if (c.passed && !base.passed) {
      cases.set(key, {
        status: 'fix',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.traceSummary?.totalCost ?? 0) - (base.traceSummary?.totalCost ?? 0),
      })
      fixes++
    } else if (!c.passed && base.passed) {
      cases.set(key, {
        status: 'regression',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.traceSummary?.totalCost ?? 0) - (base.traceSummary?.totalCost ?? 0),
      })
      regressions++
    } else {
      cases.set(key, {
        status: 'unchanged',
        durationDelta: c.durationMs - base.durationMs,
        costDelta: (c.traceSummary?.totalCost ?? 0) - (base.traceSummary?.totalCost ?? 0),
      })
      unchanged++
    }
  }

  return { baselineId, cases, regressions, fixes, unchanged, newCases }
}

// ─── DiffIndicator (small dot for matrix cells) ─────────────

export function DiffIndicator({ diff }: { diff: CaseDiff }) {
  if (diff.status === 'unchanged') return null

  const colors = {
    regression: 'bg-red-400',
    fix: 'bg-emerald-400',
    new: 'bg-blue-400',
  }

  const labels = {
    regression: 'Regression',
    fix: 'Fixed',
    new: 'New case',
  }

  return (
    <span
      className={`absolute top-1 right-1 w-2 h-2 rounded-full ${colors[diff.status]}`}
      title={labels[diff.status]}
    />
  )
}

// ─── RunComparisonBar ────────────────────────────────────────

interface RunComparisonBarProps {
  candidates: Array<{ id: string; label: string; startedAt: number }>
  baselineId: string | null
  onSelectBaseline: (id: string | null) => void
  diff: RunDiff | null
}

export function RunComparisonBar({ candidates, baselineId, onSelectBaseline, diff }: RunComparisonBarProps) {
  if (candidates.length === 0) return null

  return (
    <div className="flex items-center gap-3 text-[11px] py-2 px-1">
      <span className="text-zinc-500 shrink-0">Compare vs</span>
      <select
        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-300 text-[11px] max-w-[200px]"
        value={baselineId ?? ''}
        onChange={(e) => onSelectBaseline(e.target.value || null)}
      >
        <option value="">None</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label} — {new Date(c.startedAt).toLocaleTimeString()}
          </option>
        ))}
      </select>

      {diff && (
        <div className="flex items-center gap-2 ml-2">
          {diff.regressions > 0 && (
            <span className="text-red-400 bg-red-950/30 border border-red-900/30 rounded px-1.5 py-0.5">
              {diff.regressions} regression{diff.regressions > 1 ? 's' : ''}
            </span>
          )}
          {diff.fixes > 0 && (
            <span className="text-emerald-400 bg-emerald-950/30 border border-emerald-900/30 rounded px-1.5 py-0.5">
              {diff.fixes} fix{diff.fixes > 1 ? 'es' : ''}
            </span>
          )}
          {diff.unchanged > 0 && <span className="text-zinc-500">{diff.unchanged} unchanged</span>}
          {diff.newCases > 0 && <span className="text-blue-400">{diff.newCases} new</span>}
          {diff.cases.size > 0 &&
            (() => {
              let totalCostDelta = 0
              for (const d of diff.cases.values()) totalCostDelta += d.costDelta ?? 0
              if (Math.abs(totalCostDelta) < 0.0001) return null
              return (
                <span className={totalCostDelta > 0 ? 'text-red-400/70' : 'text-emerald-400/70'}>
                  {totalCostDelta > 0 ? '+' : ''}
                  {fmt(totalCostDelta, '$')}
                </span>
              )
            })()}
        </div>
      )}
    </div>
  )
}

// ─── Hook for eval run comparison ────────────────────────────

export function useEvalComparison(run: EvalRun, allRuns: EvalRun[]) {
  const [baselineId, setBaselineId] = useState<string | null>(null)

  const candidates = useMemo(
    () =>
      allRuns
        .filter((r) => r.evalId !== run.evalId && r.status === 'completed' && r.promptId === run.promptId)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((r) => ({
          id: r.evalId,
          label: r.promptId ?? 'unnamed',
          startedAt: r.startedAt,
        })),
    [allRuns, run.evalId, run.promptId],
  )

  const diff = useMemo(() => {
    if (!baselineId) return null
    const baseline = allRuns.find((r) => r.evalId === baselineId)
    if (!baseline) return null
    return computeEvalRunDiff(run.completedCases, baseline.completedCases, baselineId)
  }, [baselineId, allRuns, run.completedCases])

  return { candidates, baselineId, setBaselineId, diff }
}

// ─── Hook for flow run comparison ────────────────────────────

export function useFlowComparison(run: FlowRun, allRuns: FlowRun[]) {
  const [baselineId, setBaselineId] = useState<string | null>(null)

  const candidates = useMemo(
    () =>
      allRuns
        .filter((r) => r.flowId !== run.flowId && r.status === 'completed' && r.name === run.name)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map((r) => ({ id: r.flowId, label: r.name, startedAt: r.startedAt })),
    [allRuns, run.flowId, run.name],
  )

  const diff = useMemo(() => {
    if (!baselineId) return null
    const baseline = allRuns.find((r) => r.flowId === baselineId)
    if (!baseline) return null
    return computeFlowRunDiff(run.completedCases, baseline.completedCases, baselineId)
  }, [baselineId, allRuns, run.completedCases])

  return { candidates, baselineId, setBaselineId, diff }
}
