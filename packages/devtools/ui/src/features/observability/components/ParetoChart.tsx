import { useMemo } from 'react'
import type { Trace, JudgeEventData } from '@/types'

interface ParetoPoint {
  label: string
  avgCost: number
  avgScore: number
  traceCount: number
}

export function ParetoChart({ traces, judgeEvents }: { traces: Trace[]; judgeEvents: JudgeEventData[] }) {
  const points = useMemo(() => {
    // Group traces by model
    const byModel = new Map<string, { costs: number[]; traceIds: Set<string> }>()
    for (const t of traces) {
      if (t.status !== 'success' || t.result?.cost == null) continue
      const model = t.result?.modelId ?? t.model
      let group = byModel.get(model)
      if (!group) {
        group = { costs: [], traceIds: new Set() }
        byModel.set(model, group)
      }
      group.costs.push(t.result.cost)
      group.traceIds.add(t.traceId)
    }

    // Build judge score lookup by traceId
    const scoreByTrace = new Map<string, number[]>()
    for (const je of judgeEvents) {
      if (!je.traceId) continue
      let scores = scoreByTrace.get(je.traceId)
      if (!scores) {
        scores = []
        scoreByTrace.set(je.traceId, scores)
      }
      scores.push(je.score)
    }

    // Compute points
    const result: ParetoPoint[] = []
    for (const [model, group] of byModel) {
      const avgCost = group.costs.reduce((a, b) => a + b, 0) / group.costs.length
      // Compute avg judge score for this model's traces
      const scores: number[] = []
      for (const traceId of group.traceIds) {
        const traceScores = scoreByTrace.get(traceId)
        if (traceScores) {
          for (const s of traceScores) scores.push(s)
        }
      }
      if (scores.length === 0) continue // skip models with no judge data
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
      result.push({
        label: model.replace(/^[^/]+\//, ''),
        avgCost,
        avgScore,
        traceCount: group.costs.length,
      })
    }
    return result
  }, [traces, judgeEvents])

  if (points.length < 2) {
    return <div className="text-xs text-zinc-500">Need 2+ models with judge scores for Pareto analysis</div>
  }

  // Compute Pareto frontier
  const sorted = [...points].sort((a, b) => a.avgCost - b.avgCost)
  const frontier: ParetoPoint[] = []
  let maxScore = -Infinity
  for (const p of sorted) {
    if (p.avgScore > maxScore) {
      frontier.push(p)
      maxScore = p.avgScore
    }
  }

  // Chart dimensions
  const W = 400,
    H = 200,
    PAD = 40
  const minCost = Math.min(...points.map((p) => p.avgCost))
  const maxCost = Math.max(...points.map((p) => p.avgCost))
  const minScore = Math.min(...points.map((p) => p.avgScore))
  const maxScore2 = Math.max(...points.map((p) => p.avgScore))
  const costRange = maxCost - minCost || 0.001
  const scoreRange = maxScore2 - minScore || 0.1

  const toX = (cost: number) => PAD + ((cost - minCost) / costRange) * (W - PAD * 2)
  const toY = (score: number) => H - PAD - ((score - minScore) / scoreRange) * (H - PAD * 2)

  // Frontier line
  const frontierPath =
    frontier.length >= 2
      ? frontier.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.avgCost)},${toY(p.avgScore)}`).join(' ')
      : undefined

  // Color scale by score
  const colorForScore = (score: number) => {
    const t = scoreRange > 0 ? (score - minScore) / scoreRange : 0.5
    if (t >= 0.7) return 'var(--qw-ok)'
    if (t >= 0.4) return 'var(--qw-warn)'
    return 'var(--qw-danger)'
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-2">Cost vs Quality (Pareto)</h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[500px]">
        {/* Axes */}
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--qw-border-strong)" strokeWidth={1} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--qw-border-strong)" strokeWidth={1} />
        <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-zinc-600 text-[10px]">
          Avg Cost / Call
        </text>
        <text
          x={12}
          y={H / 2}
          textAnchor="middle"
          className="fill-zinc-600 text-[10px]"
          transform={`rotate(-90, 12, ${H / 2})`}
        >
          Avg Score
        </text>

        {/* Frontier line */}
        {frontierPath && (
          <path d={frontierPath} fill="none" stroke="var(--qw-ok)" strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
        )}

        {/* Points */}
        {points.map((p) => (
          <g key={p.label}>
            <circle
              cx={toX(p.avgCost)}
              cy={toY(p.avgScore)}
              r={Math.min(Math.max(p.traceCount, 4), 12)}
              fill={colorForScore(p.avgScore)}
              opacity={0.8}
            />
            <text
              x={toX(p.avgCost)}
              y={toY(p.avgScore) - 10}
              textAnchor="middle"
              className="fill-zinc-300 text-[9px] font-mono"
            >
              {p.label}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text x={PAD} y={H - PAD + 14} textAnchor="middle" className="fill-zinc-600 text-[8px] tabular-nums">
          ${minCost.toFixed(4)}
        </text>
        <text x={W - PAD} y={H - PAD + 14} textAnchor="middle" className="fill-zinc-600 text-[8px] tabular-nums">
          ${maxCost.toFixed(4)}
        </text>
        <text x={PAD - 6} y={H - PAD} textAnchor="end" className="fill-zinc-600 text-[8px] tabular-nums">
          {minScore.toFixed(2)}
        </text>
        <text x={PAD - 6} y={PAD + 4} textAnchor="end" className="fill-zinc-600 text-[8px] tabular-nums">
          {maxScore2.toFixed(2)}
        </text>
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 text-[10px]">
        {points.map((p) => (
          <div key={p.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorForScore(p.avgScore) }} />
            <span className="font-mono text-zinc-300">{p.label}</span>
            <span className="text-zinc-600">
              score:{p.avgScore.toFixed(2)} cost:${p.avgCost.toFixed(4)} ({p.traceCount})
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
