/**
 * The watch-mode output cache (spec 03 §5) — per-cell task executions keyed
 * by `(caseId, variantName, trial, taskFingerprint, paramsHash, replayMode)`
 * and persisted under `<quality dir>/cache/<evaluationId>/<key>.json`
 * (gitignored via the scaffolded `.gitignore`).
 *
 * The cache stores what re-scoring needs and nothing else: the task output,
 * the extracted trace signals, the original duration, and the trace ids.
 * Outputs are redacted at write time (cassette rule: redaction at write,
 * always) but never truncated — truncation is a record-display concern and
 * would corrupt re-scoring.
 *
 * @internal Not exported from `@crux/core/quality` — engine plumbing only.
 * @module
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Capability } from '../target'
import type { CellSignals } from './signals'
import { canonicalJson, sha256Hex } from './json'

// ─────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────

/** The full cell cache key (spec 03 §5), hashed for use as a filename. */
export function cellCacheKey(parts: {
  caseId: string
  variantName: string
  trial: number
  taskFingerprint: string
  paramsHash: string
  replayMode: string
}): string {
  return sha256Hex(canonicalJson(parts)).slice(0, 32)
}

/**
 * Fingerprint the effective params for the cache key. Params may carry
 * non-serializable values (model instances, functions) — those contribute
 * their key and type tag only, so swapping one model INSTANCE for another of
 * the same shape does not bust the cache, while adding/removing/retyping a
 * param does. Serializable values contribute fully.
 */
export function paramsFingerprint(params: Readonly<Record<string, unknown>>): string {
  const projection: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    projection[key] = serializableProjection(value)
  }
  return sha256Hex(canonicalJson(projection))
}

function serializableProjection(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map((item) => serializableProjection(item))
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const projection: Record<string, unknown> = {}
    for (const key of Object.keys(record)) {
      projection[key] = serializableProjection(record[key])
    }
    return projection
  }
  return `[${typeof value}]`
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
export type SerializedCellSignals = Omit<CellSignals, 'captured'> & { captured: Capability[] }

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
export async function readCellCache(
  cacheDir: string,
  evaluationId: string,
  key: string,
): Promise<CachedCellExecution | undefined> {
  try {
    const raw = await readFile(entryPath(cacheDir, evaluationId, key), 'utf8')
    return JSON.parse(raw) as CachedCellExecution
  } catch {
    return undefined
  }
}

/** Write one cached execution; failures are swallowed (the cache is best-effort). */
export async function writeCellCache(
  cacheDir: string,
  evaluationId: string,
  key: string,
  entry: CachedCellExecution,
): Promise<void> {
  try {
    const path = entryPath(cacheDir, evaluationId, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(entry)}\n`, 'utf8')
  } catch {
    // Best-effort: a read-only disk must not fail the run.
  }
}
