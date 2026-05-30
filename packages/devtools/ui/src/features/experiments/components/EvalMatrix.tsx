import React, { useMemo, useState, useCallback } from 'react'
import type { EvalCaseData } from '@/types'
import { useNavigation } from '@/app/navigation/useNavigation'
import { DiffIndicator, type CaseDiff } from './RunComparison'
import { EvalCaseDetail } from './EvalCaseDetail'
import { fmt } from '@/shared/components/ui-atoms'

/** Key for identifying a specific cell (case + model). */
function cellKey(caseName: string, modelId: string): string {
  return `${caseName}:${modelId}`
}

interface EvalMatrixProps {
  caseNames: string[]
  models: string[]
  cases: EvalCaseData[]
  totalCases: number
  diff?: Map<string, CaseDiff>
}

function shortName(id: string, max = 18): string {
  const name = id.includes('/') ? (id.split('/').pop() ?? id) : id
  return name.length > max ? name.slice(0, max - 1) + '\u2026' : name
}

// ─── Row bests (cheapest/fastest among passing models) ──────────

interface RowBests {
  duration: number
  tokens: number
  cost: number
  passCount: number
}

function getCellResult(cases: EvalCaseData[], caseName: string, modelId: string): EvalCaseData | undefined {
  return cases.find((c) => c.caseName === caseName && c.modelId === modelId)
}

function computeRowBests(cases: EvalCaseData[], caseName: string, models: string[]): RowBests {
  const passing = models
    .map((m) => getCellResult(cases, caseName, m))
    .filter((c): c is EvalCaseData => c != null && c.passed)

  const durations = passing.map((c) => c.durationMs)
  const tokens = passing.filter((c) => c.usage?.totalTokens != null).map((c) => c.usage?.totalTokens ?? 0)
  const costs = passing.filter((c) => c.cost != null && c.cost > 0).map((c) => c.cost ?? 0)

  return {
    duration: durations.length > 0 ? Math.min(...durations) : Infinity,
    tokens: tokens.length > 0 ? Math.min(...tokens) : Infinity,
    cost: costs.length > 0 ? Math.min(...costs) : Infinity,
    passCount: passing.length,
  }
}

// ─── Cell ───────────────────────────────────────────────────────

function Cell({
  result,
  bests,
  caseDiff,
  colorMode = 'status',
  costRange,
  isSelected,
  onSelect,
}: {
  result: EvalCaseData | undefined
  bests: RowBests
  caseDiff?: CaseDiff
  colorMode?: 'status' | 'cost'
  costRange?: { min: number; max: number }
  isSelected?: boolean
  onSelect?: () => void
}) {
  if (!result) {
    return (
      <div className="px-3 py-2 text-center">
        <span className="text-[11px] text-zinc-700">-</span>
      </div>
    )
  }

  const isPass = result.passed
  const isError = !!result.error && !isPass

  // Left border accent: green=pass, red=fail, amber=error
  const border = isError
    ? 'border-l-2 border-amber-500/60'
    : isPass
      ? 'border-l-2 border-emerald-500/50'
      : 'border-l-2 border-red-500/50'

  // Highlight best-in-row values (only when 2+ models pass)
  const hl = bests.passCount >= 2 && isPass
  const bestDur = hl && result.durationMs <= bests.duration
  const bestTok = hl && result.usage?.totalTokens != null && result.usage.totalTokens <= bests.tokens
  const bestCost = hl && result.cost != null && result.cost > 0 && result.cost <= bests.cost

  // Tooltip with full detail
  const tip: string[] = [`${result.durationMs}ms`]
  if (result.usage?.inputTokens != null) tip.push(`in:${result.usage.inputTokens}`)
  if (result.usage?.outputTokens != null) tip.push(`out:${result.usage.outputTokens}`)
  if (result.usage?.totalTokens != null) tip.push(`total:${result.usage.totalTokens}`)
  if (result.cost != null) tip.push(`$${result.cost.toFixed(6)}`)
  if (result.error) tip.push(result.error)

  const hasUsage = result.usage?.totalTokens != null || (result.cost != null && result.cost > 0)

  const clickable = true // always clickable to show detail

  // Cost heatmap background
  let heatmapStyle: React.CSSProperties | undefined
  if (colorMode === 'cost' && costRange && costRange.max > costRange.min && result.cost != null && result.cost > 0) {
    const normalized = (result.cost - costRange.min) / (costRange.max - costRange.min)
    const opacity = 0.05 + normalized * 0.2
    heatmapStyle = { backgroundColor: `rgba(239, 68, 68, ${opacity})` }
  }

  return (
    <div
      className={`${colorMode === 'status' ? border : 'border-l-2 border-zinc-700/30'} rounded-r px-3 py-1.5 relative cursor-pointer hover:bg-zinc-800/30 transition-colors ${isSelected ? 'ring-1 ring-cyan-500/50 bg-zinc-800/40' : ''}`}
      title={tip.join(' \u00b7 ')}
      onClick={onSelect}
      style={heatmapStyle}
    >
      {caseDiff && <DiffIndicator diff={caseDiff} />}
      {/* Duration — always visible */}
      <div className={`text-[11px] tabular-nums leading-tight ${bestDur ? 'text-emerald-400' : 'text-zinc-400'}`}>
        {fmt(result.durationMs, 'ms')}
      </div>

      {/* Tokens + Cost */}
      {hasUsage && (
        <div className="flex items-baseline gap-1.5 mt-0.5">
          {result.usage?.totalTokens != null && (
            <span
              className={`text-[11px] tabular-nums leading-tight ${bestTok ? 'text-emerald-400' : 'text-zinc-500'}`}
            >
              {fmt(result.usage.totalTokens, 'tok')}
            </span>
          )}
          {result.usage?.totalTokens != null && result.cost != null && result.cost > 0 && (
            <span className="text-zinc-700 text-[9px]">&middot;</span>
          )}
          {result.cost != null && result.cost > 0 && (
            <span
              className={`text-[11px] tabular-nums leading-tight ${bestCost ? 'text-emerald-400' : 'text-zinc-600'}`}
            >
              {fmt(result.cost, '$')}
            </span>
          )}
        </div>
      )}

      {/* Error preview (when no usage data) */}
      {!hasUsage && isError && result.error && (
        <div className="text-[10px] text-amber-400/60 truncate mt-0.5 leading-tight" title={result.error}>
          {result.error.slice(0, 35)}
        </div>
      )}
    </div>
  )
}

// ─── Cell detail (inline expansion) ─────────────────────────────

function CellDetail({
  result,
  navigate,
}: {
  result: EvalCaseData
  navigate: ReturnType<typeof useNavigation>['navigate']
}) {
  return (
    <EvalCaseDetail
      result={result}
      onViewTrace={result.traceId ? () => navigate({ view: 'run-detail', traceId: result.traceId! }) : undefined}
    />
  )
}

// ─── Matrix ─────────────────────────────────────────────────────

export function EvalMatrix({ caseNames, models, cases, diff }: EvalMatrixProps) {
  const { navigate } = useNavigation()
  const [colorMode, setColorMode] = useState<'status' | 'cost'>('status')
  const [selectedCell, setSelectedCell] = useState<string | null>(null)

  const handleCellSelect = useCallback((caseName: string, modelId: string) => {
    const key = cellKey(caseName, modelId)
    setSelectedCell((prev) => (prev === key ? null : key))
  }, [])

  // Compute cost range for heatmap mode
  const costRange = useMemo(() => {
    const costs = cases.filter((c) => c.cost != null && c.cost > 0).map((c) => c.cost!)
    if (costs.length === 0) return { min: 0, max: 0 }
    return { min: Math.min(...costs), max: Math.max(...costs) }
  }, [cases])

  const rowBests = useMemo(() => {
    const map = new Map<string, RowBests>()
    for (const name of caseNames) map.set(name, computeRowBests(cases, name, models))
    return map
  }, [caseNames, models, cases])

  const colTotals = useMemo(
    () =>
      models.map((id) => {
        const mc = cases.filter((c) => c.modelId === id)
        const passed = mc.filter((c) => c.passed).length
        let tokens = 0,
          cost = 0,
          dur = 0
        for (const c of mc) {
          dur += c.durationMs
          if (c.usage?.totalTokens) tokens += c.usage.totalTokens
          if (c.cost) cost += c.cost
        }
        return { id, passed, total: mc.length, tokens, cost, dur }
      }),
    [models, cases],
  )

  return (
    <div className="overflow-x-auto">
      {costRange.max > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={() => setColorMode((m) => (m === 'status' ? 'cost' : 'status'))}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-0.5 rounded border border-zinc-800 transition-colors"
          >
            {colorMode === 'status' ? 'Show cost heatmap' : 'Show pass/fail'}
          </button>
        </div>
      )}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left text-[11px] py-2 pr-3 text-zinc-500 font-medium sticky left-0 bg-zinc-900 z-10">
              Case
            </th>
            {models.map((m) => (
              <th
                key={m}
                className="text-left text-[11px] py-2 px-1.5 text-zinc-500 font-medium font-mono cursor-help whitespace-nowrap"
                title={m}
              >
                {shortName(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {caseNames.map((cn) => {
            // Check if any cell in this row is selected
            const selectedInRow = models.find((m) => cellKey(cn, m) === selectedCell)
            const selectedResult = selectedInRow ? getCellResult(cases, cn, selectedInRow) : undefined

            return (
              <React.Fragment key={cn}>
                <tr className="border-t border-zinc-800/30">
                  <td className="py-1.5 pr-3 text-[11px] text-zinc-300 font-mono sticky left-0 bg-zinc-900 z-10 align-top pt-3">
                    {cn}
                  </td>
                  {models.map((m) => (
                    <td key={m} className="py-1.5 px-1.5 align-top">
                      <Cell
                        result={getCellResult(cases, cn, m)}
                        bests={rowBests.get(cn) ?? computeRowBests(cases, cn, models)}
                        caseDiff={diff?.get(`${cn}:${m}`)}
                        colorMode={colorMode}
                        costRange={costRange}
                        isSelected={cellKey(cn, m) === selectedCell}
                        onSelect={() => handleCellSelect(cn, m)}
                      />
                    </td>
                  ))}
                </tr>
                {/* Inline detail row for selected cell */}
                {selectedResult && (
                  <tr>
                    <td colSpan={models.length + 1} className="px-3 py-3 border-t border-cyan-900/30 bg-zinc-900/80">
                      <CellDetail result={selectedResult} navigate={navigate} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            )
          })}

          {/* Totals row */}
          <tr className="border-t-2 border-zinc-700">
            <td className="py-2.5 pr-3 text-[11px] text-zinc-500 font-medium sticky left-0 bg-zinc-900 z-10">Total</td>
            {colTotals.map((ct) => {
              const rate = ct.total > 0 ? Math.round((ct.passed / ct.total) * 100) : 0
              const color =
                ct.total === 0
                  ? 'text-zinc-600'
                  : rate === 100
                    ? 'text-emerald-400'
                    : rate >= 50
                      ? 'text-amber-400'
                      : 'text-red-400'
              return (
                <td key={ct.id} className="py-2.5 px-1.5">
                  <div className="px-3 space-y-0.5">
                    <div className={`text-[11px] font-medium tabular-nums ${color}`}>
                      {ct.passed}/{ct.total}
                    </div>
                    {(ct.tokens > 0 || ct.cost > 0) && (
                      <div className="flex items-baseline gap-1.5">
                        {ct.tokens > 0 && (
                          <span className="text-[11px] tabular-nums text-zinc-500">{fmt(ct.tokens, 'tok')}</span>
                        )}
                        {ct.tokens > 0 && ct.cost > 0 && <span className="text-zinc-700 text-[9px]">&middot;</span>}
                        {ct.cost > 0 && (
                          <span className="text-[11px] tabular-nums text-zinc-600">{fmt(ct.cost, '$')}</span>
                        )}
                      </div>
                    )}
                    <div className="text-[11px] tabular-nums text-zinc-600">{fmt(ct.dur, 'ms')}</div>
                  </div>
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
