/**
 * The watch-mode output cache (spec 03 §5) — per-cell task executions keyed
 * by semantic cell identity: evaluation id, case identity plus input
 * fingerprint, variant, trial, task fingerprint, and params fingerprint.
 * and persisted under `<quality dir>/cache/<evaluationId>/<key>.json`
 * (gitignored via the scaffolded `.gitignore`).
 *
 * The cache stores what re-scoring needs and nothing else: the task output,
 * the extracted trace signals, the original duration, and the trace ids.
 * Outputs are redacted at write time (cassette rule: redaction at write,
 * always) but never truncated — truncation is a record-display concern and
 * would corrupt re-scoring.
 *
 * @internal Not exported from `@use-crux/core/quality` — engine plumbing only.
 * @module
 */

import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Capability } from '../target'
import type { CellSignals } from './signals'
import { canonicalJson, sha256Hex } from './json'
import { OUTPUT_CACHE_EPOCH, fingerprintValue } from './cache-identity'
import { writeFileAtomic } from './fs-atomic'
import { withFileLock } from './fs-lock'

// ─────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────

/** The full cell cache key (spec 03 §5), hashed for use as a filename. */
export function cellCacheKey(parts: { evaluationId: string; caseKey: string; variantName: string; trial: number; taskFingerprint: string; paramsFingerprint: string }): string {
  return sha256Hex(canonicalJson({ epoch: OUTPUT_CACHE_EPOCH, ...parts })).slice(0, 32)
}

/**
 * Fingerprint the effective params for the cache key.
 *
 * Params may carry non-serializable values (model instances, functions).
 * Function leaves contribute a source fingerprint; object leaves contribute
 * their enumerable data. This can over-invalidate, but it must not reuse stale
 * outputs after a semantic param change.
 */
export function paramsFingerprint(params: Readonly<Record<string, unknown>>): string {
  return fingerprintValue(params)
}

// ─────────────────────────────────────────────────────────────────
// Entries
// ─────────────────────────────────────────────────────────────────

/** One cached cell execution — everything a re-score needs. */
export interface CachedCellExecution {
  /** Redacted (never truncated) task output. */
  output: unknown
  signals: SerializedCellSignals
  durationMs: number
  traceIds: string[]
  cachedAt: string
}

/** `CellSignals` with the `captured` Set lowered to an array for JSON. */
export type SerializedCellSignals = Omit<CellSignals, 'captured'> & {
  captured: Capability[]
}

export function serializeCellSignals(signals: CellSignals): SerializedCellSignals {
  return { ...signals, captured: [...signals.captured] }
}

export function deserializeCellSignals(serialized: SerializedCellSignals): CellSignals {
  return { ...serialized, captured: new Set(serialized.captured) }
}

// ─────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────

function entryPath(cacheDir: string, evaluationId: string, key: string): string {
  // Evaluation ids may contain path-hostile characters (`#`, `/`); the
  // directory name only needs to be stable and collision-free.
  const dirName = `${evaluationId.replace(/[^a-zA-Z0-9._-]/g, '_')}-${sha256Hex(evaluationId).slice(0, 8)}`
  return join(cacheDir, dirName, `${key}.json`)
}

/** Read one cached execution; any read/parse problem is a miss, never an error. */
export async function readCellCache(cacheDir: string, evaluationId: string, key: string): Promise<CachedCellExecution | undefined> {
  try {
    const raw = await readFile(entryPath(cacheDir, evaluationId, key), 'utf8')
    return JSON.parse(raw) as CachedCellExecution
  } catch {
    return undefined
  }
}

/** Write one cached execution; failures are swallowed (the cache is best-effort). */
export async function writeCellCache(cacheDir: string, evaluationId: string, key: string, entry: CachedCellExecution): Promise<void> {
  try {
    const path = entryPath(cacheDir, evaluationId, key)
    await mkdir(dirname(path), { recursive: true })
    await withFileLock(path, () => writeFileAtomic(path, `${JSON.stringify(entry)}\n`))
  } catch {
    // Best-effort: a read-only disk must not fail the run.
  }
}
