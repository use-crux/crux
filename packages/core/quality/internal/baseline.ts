/**
 * Baseline records (spec 02 §3) — explicitly promoted experiments, written to
 * `<quality dir>/baselines/<evaluationId>.json` and COMMITTED to the repo.
 * The committed file is how CI knows the reference: every run auto-compares
 * against it, and `minDeltaVsBaseline` gates become evaluable.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ExperimentCell } from '../experiment'
import { sha256Hex } from './json'

/** The committed baseline record (spec 02 §3). */
export interface BaselineRecord {
  schemaVersion: 1
  /** ULID. */
  baselineId: string
  /** Explicit (pinned) at promote time. */
  evaluationId: string
  /** The promoted experiment. */
  experimentId: string
  /** Observability run identity of the promoted evaluation, when available. */
  observability?: { runId: string; traceId: string }
  variantName?: string
  promotedAt: string
  /** git user.name, best-effort. */
  promotedBy?: string
  /** Of the promoted run — drift detection. */
  configFingerprint: string
  /** Frozen per-case reference values: caseId → mean score per name. */
  reference: Record<string, Record<string, number>>
}

/**
 * Filename for a baseline. Clean ids map to `<id>.json` (the committed,
 * reviewable artifact the spec names); ids with path-hostile characters get
 * a sanitized name with a hash suffix so distinct ids can never collide.
 *
 * @internal
 */
export function baselineRecordPath(dir: string, evaluationId: string): string {
  const safe = /^[a-zA-Z0-9._-]+$/.test(evaluationId)
  const fileName = safe
    ? `${evaluationId}.json`
    : `${evaluationId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${sha256Hex(evaluationId).slice(0, 8)}.json`
  return join(dir, 'baselines', fileName)
}

/** Read the committed baseline for an evaluation; absent/unreadable → undefined. @internal */
export async function readBaselineRecord(dir: string, evaluationId: string): Promise<BaselineRecord | undefined> {
  try {
    const raw = await readFile(baselineRecordPath(dir, evaluationId), 'utf8')
    const parsed = JSON.parse(raw) as BaselineRecord
    if (typeof parsed.evaluationId !== 'string' || typeof parsed.configFingerprint !== 'string') return undefined
    return parsed
  } catch {
    return undefined
  }
}

/** Write (or overwrite — git history is the audit log) the baseline record. @internal */
export async function writeBaselineRecord(dir: string, record: BaselineRecord): Promise<string> {
  await mkdir(join(dir, 'baselines'), { recursive: true })
  const path = baselineRecordPath(dir, record.evaluationId)
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  return path
}

/**
 * List every committed baseline under a quality dir. Used by the id-drift
 * guard: a run whose definition fingerprint matches a baseline promoted
 * under a DIFFERENT id was promoted-then-not-pinned (spec 01 §8).
 *
 * @internal
 */
export async function listBaselineRecords(dir: string): Promise<BaselineRecord[]> {
  let files: string[]
  try {
    files = await readdir(join(dir, 'baselines'))
  } catch {
    return []
  }
  const records: BaselineRecord[] = []
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await readFile(join(dir, 'baselines', file), 'utf8')
      const parsed = JSON.parse(raw) as BaselineRecord
      if (typeof parsed.evaluationId === 'string' && typeof parsed.configFingerprint === 'string') {
        records.push(parsed)
      }
    } catch {
      // Unreadable baselines are skipped — the drift guard is best-effort.
    }
  }
  return records
}

/**
 * Freeze one variant's per-case mean scores (trials averaged) as the paired
 * comparison reference of a baseline record.
 *
 * @internal
 */
export function buildBaselineReference(
  cells: readonly ExperimentCell<unknown, unknown>[],
  variantName: string,
): Record<string, Record<string, number>> {
  const sums = new Map<string, Map<string, { total: number; count: number }>>()
  for (const cell of cells) {
    if (cell.variantName !== variantName || cell.status === 'skipped') continue
    let perScore = sums.get(cell.caseId)
    if (perScore === undefined) {
      perScore = new Map()
      sums.set(cell.caseId, perScore)
    }
    for (const score of cell.scores) {
      if (score.score === null) continue
      const bucket = perScore.get(score.name)
      if (bucket === undefined) perScore.set(score.name, { total: score.score, count: 1 })
      else {
        bucket.total += score.score
        bucket.count += 1
      }
    }
  }
  const reference: Record<string, Record<string, number>> = {}
  for (const [caseId, perScore] of sums) {
    const caseReference: Record<string, number> = {}
    for (const [name, { total, count }] of perScore) caseReference[name] = total / count
    reference[caseId] = caseReference
  }
  return reference
}

/** `git config user.name`, best-effort (promotedBy provenance). @internal */
export function gitUserName(cwd: string): string | undefined {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return name === '' ? undefined : name
  } catch {
    return undefined
  }
}
