/**
 * Experiment-to-experiment diff for machine consumers.
 *
 * Baseline comparison stays in `compare.ts`; this module handles arbitrary
 * persisted records for `crux quality diff` and agent workflows.
 *
 * @internal
 * @module
 */

import type { ExperimentCell } from '../experiment'
import type { ExperimentDiff, ExperimentDiffDatasetProvenance, ExperimentRecord } from '../schema-types'

interface DiffCaseStats {
  caseId: string
  variant: string
  passed: boolean
  scores: ReadonlyMap<string, number>
  datasetProvenance?: ExperimentDiffDatasetProvenance
}

/** Compare two persisted experiment records for machine consumers. */
export function compareExperiments(a: ExperimentRecord, b: ExperimentRecord): ExperimentDiff {
  const aCases = diffCaseStats(a.cells)
  const bCases = diffCaseStats(b.cells)
  const aKeys = new Set(aCases.keys())
  const bKeys = new Set(bCases.keys())
  const matchedKeys = [...aKeys].filter((key) => bKeys.has(key)).sort()
  const onlyInA = uniqueSortedCaseIds([...aKeys].filter((key) => !bKeys.has(key)), aCases)
  const onlyInB = uniqueSortedCaseIds([...bKeys].filter((key) => !aKeys.has(key)), bCases)
  const fingerprintDrift = fingerprintDriftOf(a, b)

  return {
    schemaVersion: 1,
    a: { experimentId: a.experimentId },
    b: { experimentId: b.experimentId },
    comparable: fingerprintDrift.length === 0,
    fingerprintDrift,
    scores: diffScores(matchedKeys, aCases, bCases),
    cases: matchedKeys.map((key) => diffCase(key, aCases, bCases)),
    onlyInA,
    onlyInB,
    gatesVerdict: { aPassed: a.gates.passed, bPassed: b.gates.passed },
  }
}

function diffCaseStats(cells: readonly ExperimentCell<unknown, unknown>[]): Map<string, DiffCaseStats> {
  const grouped = new Map<string, ExperimentCell<unknown, unknown>[]>()
  for (const cell of cells) {
    if (cell.status === 'skipped') continue
    const key = `${cell.caseId}\u0000${cell.variantName}`
    const group = grouped.get(key)
    if (group === undefined) grouped.set(key, [cell])
    else group.push(cell)
  }
  return new Map(
    [...grouped].map(([key, group]) => {
      const first = group[0]!
      return [
        key,
        {
          caseId: first.caseId,
          variant: first.variantName,
          passed: group.every((cell) => cell.status === 'passed'),
          scores: scoreMeans(group),
          datasetProvenance: datasetProvenanceOf(group),
        },
      ]
    }),
  )
}

function scoreMeans(cells: readonly ExperimentCell<unknown, unknown>[]): ReadonlyMap<string, number> {
  const sums = new Map<string, { total: number; count: number }>()
  for (const cell of cells) {
    for (const score of cell.scores) {
      if (score.score === null) continue
      const bucket = sums.get(score.name)
      if (bucket === undefined) sums.set(score.name, { total: score.score, count: 1 })
      else {
        bucket.total += score.score
        bucket.count += 1
      }
    }
  }
  return new Map([...sums].map(([name, value]) => [name, value.total / value.count]))
}

function uniqueSortedCaseIds(keys: readonly string[], stats: ReadonlyMap<string, DiffCaseStats>): string[] {
  return [...new Set(keys.map((key) => stats.get(key)?.caseId).filter((caseId): caseId is string => caseId !== undefined))].sort()
}

function fingerprintDriftOf(a: ExperimentRecord, b: ExperimentRecord): string[] {
  const drift: string[] = []
  if (a.configFingerprint !== b.configFingerprint) drift.push('config')
  if (a.taskFingerprint !== b.taskFingerprint) drift.push('task')
  return drift
}

function diffScores(
  matchedKeys: readonly string[],
  aCases: ReadonlyMap<string, DiffCaseStats>,
  bCases: ReadonlyMap<string, DiffCaseStats>,
): ExperimentDiff['scores'] {
  const pairs = new Map<string, Array<{ a: number; b: number; delta: number }>>()
  for (const key of matchedKeys) {
    const aStats = aCases.get(key)
    const bStats = bCases.get(key)
    if (aStats === undefined || bStats === undefined) continue
    for (const [name, bMean] of bStats.scores) {
      const aMean = aStats.scores.get(name)
      if (aMean === undefined) continue
      const bucket = pairs.get(name)
      const pair = { a: aMean, b: bMean, delta: bMean - aMean }
      if (bucket === undefined) pairs.set(name, [pair])
      else bucket.push(pair)
    }
  }
  return [...pairs]
    .map(([name, values]) => {
      const delta = meanOf(values.map((value) => value.delta))
      const sem = semOf(values.map((value) => value.delta))
      return {
        name,
        aMean: meanOf(values.map((value) => value.a)),
        bMean: meanOf(values.map((value) => value.b)),
        delta,
        sem,
        significant: Math.abs(delta) > 0 && Math.abs(delta) >= sem,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name))
}

function diffCase(
  key: string,
  aCases: ReadonlyMap<string, DiffCaseStats>,
  bCases: ReadonlyMap<string, DiffCaseStats>,
): ExperimentDiff['cases'][number] {
  const aStats = aCases.get(key)!
  const bStats = bCases.get(key)!
  const scoreDeltas: Record<string, number> = {}
  const scoreNames = [...new Set([...aStats.scores.keys(), ...bStats.scores.keys()])].sort()
  for (const name of scoreNames) {
    const aMean = aStats.scores.get(name)
    const bMean = bStats.scores.get(name)
    if (aMean !== undefined && bMean !== undefined) scoreDeltas[name] = bMean - aMean
  }
  return {
    caseId: aStats.caseId,
    variant: aStats.variant,
    aPassed: aStats.passed,
    bPassed: bStats.passed,
    scoreDeltas,
    ...(bStats.datasetProvenance ?? aStats.datasetProvenance
      ? { datasetProvenance: bStats.datasetProvenance ?? aStats.datasetProvenance }
      : {}),
  }
}

function datasetProvenanceOf(cells: readonly ExperimentCell<unknown, unknown>[]): ExperimentDiffDatasetProvenance | undefined {
  for (const cell of cells) {
    const metadata = cell.metadata
    if (metadata === undefined || typeof metadata !== 'object' || metadata === null) continue
    const provenance = (metadata as Record<string, unknown>).datasetProvenance
    if (provenance === undefined || typeof provenance !== 'object' || provenance === null) continue
    const path = (provenance as Record<string, unknown>).path
    const contentFingerprint = (provenance as Record<string, unknown>).contentFingerprint
    if (typeof path === 'string' && typeof contentFingerprint === 'string') return { path, contentFingerprint }
  }
  return undefined
}

function meanOf(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function semOf(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = meanOf(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance / values.length)
}
