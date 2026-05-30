import React, { useState, useMemo } from 'react'
import type { FlowCaseData } from '@/types'
import { FlowCaseDetail } from './FlowCaseDetail'
import { DiffIndicator, type CaseDiff } from './RunComparison'
import { fmt } from '@/shared/components/ui-atoms'

export interface FlowMatrixProps {
  caseNames: string[]
  configNames: string[]
  cases: FlowCaseData[]
  totalCases: number
  diff?: Map<string, CaseDiff>
}

// ─── Row bests (cheapest/fastest among passing configs) ─────────

interface RowBests {
  duration: number
  tokens: number
  cost: number
  passCount: number
}

function getCellResult(cases: FlowCaseData[], caseName: string, configName: string): FlowCaseData | undefined {
  return cases.find((c) => c.caseName === caseName && c.configName === configName)
}

function computeRowBests(cases: FlowCaseData[], caseName: string, configNames: string[]): RowBests {
  const passing = configNames
    .map((cfg) => getCellResult(cases, caseName, cfg))
    .filter((c): c is FlowCaseData => c != null && c.passed)

  const durations = passing.map((c) => c.durationMs)
  const tokens = passing.filter((c) => c.traceSummary.totalTokens > 0).map((c) => c.traceSummary.totalTokens)
  const costs = passing.filter((c) => c.traceSummary.totalCost > 0).map((c) => c.traceSummary.totalCost)

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
  isSelected,
  onClick,
  caseDiff,
  colorMode = 'status',
  costRange,
}: {
  result: FlowCaseData | undefined
  bests: RowBests
  isSelected: boolean
  onClick?: () => void
  caseDiff?: CaseDiff
  colorMode?: 'status' | 'cost'
  costRange?: { min: number; max: number }
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
  const ts = result.traceSummary

  const border = isError
    ? 'border-l-2 border-amber-500/60'
    : isPass
      ? 'border-l-2 border-emerald-500/50'
      : 'border-l-2 border-red-500/50'

  // Highlight best-in-row values (only when 2+ configs pass)
  const hl = bests.passCount >= 2 && isPass
  const bestDur = hl && result.durationMs <= bests.duration
  const bestTok = hl && ts.totalTokens > 0 && ts.totalTokens <= bests.tokens
  const bestCost = hl && ts.totalCost > 0 && ts.totalCost <= bests.cost

  // Tooltip with full detail
  const tip: string[] = [`${result.durationMs}ms`, `${ts.stepCount} steps`]
  if (ts.totalTokens > 0) tip.push(`${ts.totalTokens} tokens`)
  if (ts.totalCost > 0) tip.push(`$${ts.totalCost.toFixed(6)}`)
  if (ts.toolCallNames.length > 0) tip.push(`tools: ${ts.toolCallNames.join(', ')}`)
  if (result.error) tip.push(result.error)

  const hasUsage = ts.totalTokens > 0 || ts.totalCost > 0
  const hasSteps = ts.steps && ts.steps.length > 0

  // Cost heatmap background
  let heatmapStyle: React.CSSProperties | undefined
  if (colorMode === 'cost' && costRange && costRange.max > costRange.min && ts.totalCost > 0) {
    const normalized = (ts.totalCost - costRange.min) / (costRange.max - costRange.min)
    const opacity = 0.05 + normalized * 0.2
    heatmapStyle = { backgroundColor: `rgba(239, 68, 68, ${opacity})` }
  }

  return (
    <div
      className={`${colorMode === 'status' ? border : 'border-l-2 border-zinc-700/30'} rounded-r px-3 py-1.5 relative ${hasSteps ? 'cursor-pointer hover:bg-zinc-800/30' : 'cursor-default'} transition-colors ${isSelected ? 'ring-1 ring-blue-500/60 bg-zinc-800/20' : ''}`}
      title={tip.join(' \u00b7 ')}
      onClick={hasSteps ? onClick : undefined}
      style={heatmapStyle}
    >
      {caseDiff && <DiffIndicator diff={caseDiff} />}
      {/* Duration */}
      <div className={`text-[11px] tabular-nums leading-tight ${bestDur ? 'text-emerald-400' : 'text-zinc-400'}`}>
        {fmt(result.durationMs, 'ms')}
      </div>

      {/* Tokens + Cost */}
      {hasUsage && (
        <div className="flex items-baseline gap-1.5 mt-0.5">
          {ts.totalTokens > 0 && (
            <span
              className={`text-[11px] tabular-nums leading-tight ${bestTok ? 'text-emerald-400' : 'text-zinc-500'}`}
            >
              {fmt(ts.totalTokens, 'tok')}
            </span>
          )}
          {ts.totalTokens > 0 && ts.totalCost > 0 && <span className="text-zinc-700 text-[9px]">&middot;</span>}
          {ts.totalCost > 0 && (
            <span
              className={`text-[11px] tabular-nums leading-tight ${bestCost ? 'text-emerald-400' : 'text-zinc-600'}`}
            >
              {fmt(ts.totalCost, '$')}
            </span>
          )}
        </div>
      )}

      {/* Tool calls preview */}
      {ts.toolCallNames.length > 0 && (
        <div className="text-[10px] text-zinc-600 truncate mt-0.5 leading-tight">
          {ts.toolCallNames.slice(0, 3).join(', ')}
          {ts.toolCallNames.length > 3 && ` +${ts.toolCallNames.length - 3}`}
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

// ─── Matrix ─────────────────────────────────────────────────────

export function FlowMatrix({ caseNames, configNames, cases, diff }: FlowMatrixProps) {
  const [colorMode, setColorMode] = useState<'status' | 'cost'>('status')

  const costRange = useMemo(() => {
    const costs = cases.filter((c) => c.traceSummary.totalCost > 0).map((c) => c.traceSummary.totalCost)
    if (costs.length === 0) return { min: 0, max: 0 }
    return { min: Math.min(...costs), max: Math.max(...costs) }
  }, [cases])

  const [selectedCell, setSelectedCell] = useState<{
    caseName: string
    configName: string
  } | null>(null)

  const rowBests = useMemo(() => {
    const map = new Map<string, RowBests>()
    for (const name of caseNames) map.set(name, computeRowBests(cases, name, configNames))
    return map
  }, [caseNames, configNames, cases])

  const colTotals = useMemo(
    () =>
      configNames.map((cfg) => {
        const mc = cases.filter((c) => c.configName === cfg)
        const passed = mc.filter((c) => c.passed).length
        let tokens = 0,
          cost = 0,
          dur = 0
        for (const c of mc) {
          dur += c.durationMs
          tokens += c.traceSummary.totalTokens
          cost += c.traceSummary.totalCost
        }
        return { cfg, passed, total: mc.length, tokens, cost, dur }
      }),
    [configNames, cases],
  )

  function handleCellClick(caseName: string, configName: string) {
    if (selectedCell?.caseName === caseName && selectedCell?.configName === configName) {
      setSelectedCell(null)
    } else {
      setSelectedCell({ caseName, configName })
    }
  }

  const selectedResult = selectedCell ? getCellResult(cases, selectedCell.caseName, selectedCell.configName) : undefined
  const selectedSteps = selectedResult?.traceSummary.steps

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
            {configNames.map((cfg) => (
              <th
                key={cfg}
                className="text-left text-[11px] py-2 px-1.5 text-zinc-500 font-medium font-mono whitespace-nowrap"
              >
                {cfg}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {caseNames.map((cn) => {
            const isSelectedRow = selectedCell?.caseName === cn
            return (
              <tr key={cn}>
                <td colSpan={configNames.length + 1} className="p-0">
                  {/* Data row */}
                  <table className="w-full border-collapse">
                    <tbody>
                      <tr className="border-t border-zinc-800/30">
                        <td className="py-1.5 pr-3 text-[11px] text-zinc-300 font-mono sticky left-0 bg-zinc-900 z-10 align-top pt-3">
                          {cn}
                        </td>
                        {configNames.map((cfg) => {
                          const isSel = selectedCell?.caseName === cn && selectedCell?.configName === cfg
                          return (
                            <td key={cfg} className="py-1.5 px-1.5 align-top">
                              <Cell
                                result={getCellResult(cases, cn, cfg)}
                                bests={rowBests.get(cn) ?? computeRowBests(cases, cn, configNames)}
                                isSelected={isSel}
                                onClick={() => handleCellClick(cn, cfg)}
                                caseDiff={diff?.get(`${cn}:${cfg}`)}
                                colorMode={colorMode}
                                costRange={costRange}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>

                  {/* Inline detail panel */}
                  {isSelectedRow && selectedSteps && selectedSteps.length > 0 && (
                    <div className="px-1.5 pb-2 pt-1">
                      <FlowCaseDetail steps={selectedSteps} onClose={() => setSelectedCell(null)} />
                    </div>
                  )}
                </td>
              </tr>
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
                <td key={ct.cfg} className="py-2.5 px-1.5">
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
