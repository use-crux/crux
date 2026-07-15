/**
 * Cassette runtime — deterministic record/replay of model calls at the
 * executor boundary (spec 01 §10).
 *
 * A cassette session owns one cassette file for one evaluation run. Its
 * `intercept` implements the {@link GenerationInterceptor} contract: per
 * call it computes the normalized match key, then — depending on the mode —
 * replays a recorded entry, records a live result, or fails the call closed
 * with the missing key.
 *
 * Storage: `.crux/quality/cassettes/<name>.json`, committed like a fixture.
 * Redaction (configured dot-paths + the always-on authorization/api-key
 * defaults) applies at write time, always. Raw SDK result objects are never
 * stored — replayed outcomes carry `raw: undefined`.
 *
 * @internal
 * @module
 */

import { readFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { z } from 'zod'
import { observe } from '../../observability'
import type { InterceptedGeneration } from '../../adapter/interception'
import type { NormalizedCall, ReplayMode } from '../replay'
import { canonicalJson, sha256Hex } from './json'
import { applyRedaction } from './redact'
import { CASSETTE_CACHE_EPOCH, fingerprintSchema, fingerprintValue } from './cache-identity'
import { writeFileAtomic } from './fs-atomic'
import { withFileLock } from './fs-lock'
import { shouldQuarantineQualityWrite } from './capture-context'
import { REDACTED, redactSensitiveText } from '../../shared/redaction'

/** Days after which a cassette's recordings are considered stale. */
const STALE_AFTER_DAYS = 90

/** One recorded model call. */
interface CassetteEntry {
  kind: 'loop' | 'structured' | 'value'
  /** Debuggability snapshot of the call identity (redacted). */
  call: NormalizedCall
  /** Serializable projection of the spec method's result (redacted). */
  result: unknown
  recordedAt: string
}

interface CassetteFile {
  version: 1
  metadata: { recordedAt: string; sdkVersion: string; models: string[] }
  recorded?: { runId: string; traceId: string; recordedAt: string }
  entries: Record<string, CassetteEntry>
}

/** Cassette file location: `<quality dir>/cassettes/<name>.json` (safe-named). */
export function cassettePath(dir: string, name: string): string {
  const safe = /^[a-zA-Z0-9._-]+$/.test(name)
  const fileName = safe ? `${name}.json` : `${name.replace(/[^a-zA-Z0-9._-]/g, '_')}-${sha256Hex(name).slice(0, 8)}.json`
  return join(dir, 'cassettes', fileName)
}

/**
 * Build the normalized call the match key hashes (spec 01 §10): call kind,
 * target id, prompt hash, model, canonicalized settings, tool schema hash.
 * Volatile fields (timestamps, request ids, signals, observers) are excluded
 * by construction — they never reach {@link InterceptedGeneration}.
 */
export function buildNormalizedCall(call: InterceptedGeneration): NormalizedCall {
  const promptHash = fingerprintValue(
    {
      system: call.system,
      prompt: call.prompt,
      messages: call.messages,
    },
  )
  return {
    epoch: CASSETTE_CACHE_EPOCH,
    kind: call.kind,
    ...(call.promptId !== undefined ? { targetId: call.promptId } : {}),
    promptHash,
    model: `${call.modelInfo.provider}/${call.modelInfo.modelId}`,
    settings: call.settings,
    outputSchemaFingerprint: fingerprintSchema(call.outputSchema),
    ...(call.tools !== undefined
      ? {
          toolSchemas: call.tools
            .map((tool) => ({
              name: tool.name,
              paramsFingerprint: fingerprintSchema(tool.parameters),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        }
      : {}),
  }
}

/** The default match key: hash of the normalized call. */
export function normalizedCallKey(call: InterceptedGeneration): string {
  return sha256Hex(canonicalJson(buildNormalizedCall(call)))
}

function emptyCassetteFile(sdkVersionValue: string): CassetteFile {
  return {
    version: 1,
    metadata: {
      recordedAt: new Date().toISOString(),
      sdkVersion: sdkVersionValue,
      models: [],
    },
    entries: {},
  }
}

/** A replay-strict miss: the cell fails closed with the key and a re-record hint. */
export class CassetteMissError extends Error {
  readonly key: string
  constructor(key: string, call: NormalizedCall, path: string) {
    super(
      `cassette replay miss (replay-strict): no entry ${key} for ${call.kind} call to ` +
        `${call.targetId ?? '(anonymous)'} on ${call.model ?? '(unknown model)'} in ${path} — ` +
        `re-record with \`crux quality run --replay record-new\` (or refresh to re-record everything).`,
    )
    this.name = 'CassetteMissError'
    this.key = key
  }
}

/** A sanitized error reconstructed from a recorded thrown outcome. */
export class CassetteRecordedError extends Error {
  constructor(name: string, message: string) {
    super(message)
    this.name = name
  }
}

/** A cassette entry whose stored key does not match its normalized call. */
export class CassetteCorruptionError extends Error {
  readonly path: string
  readonly key: string
  constructor(path: string, key: string) {
    super(
      `corrupt cassette ${path}: entry ${key} does not match its recorded call`,
    )
    this.name = 'CassetteCorruptionError'
    this.path = path
    this.key = key
  }
}

// ─────────────────────────────────────────────────────────────────
// Result projection — what gets stored, what comes back
// ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

/** JSON-roundtrip a value, dropping anything non-serializable (best effort). */
function toSerializable(value: unknown): unknown {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return undefined
  }
}

/**
 * Project a live spec result to its recordable payload. Returns `undefined`
 * for results replay cannot honestly reproduce (suspended loops) — those
 * pass through live and are never recorded.
 */
function projectResult(result: unknown): unknown {
  if (!isRecord(result)) return undefined
  if (containsImplicitMedia(result)) return undefined
  if (result.status === 'complete') {
    return {
      status: 'complete',
      response: toSerializable(result.response),
      messages: toSerializable(result.messages) ?? [],
      steps: Array.isArray(result.steps) ? result.steps.length : 1,
      meta: toSerializable(result.meta) ?? {},
    }
  }
  if (result.status === 'ok') {
    return {
      status: 'ok',
      response: toSerializable(result.response),
      object: toSerializable(result.object),
    }
  }
  if (result.status === 'invalid') {
    const error = result.error
    return {
      status: 'invalid',
      rawText: typeof result.rawText === 'string' ? result.rawText : '',
      issues: error instanceof z.ZodError ? toSerializable(error.issues) : [],
    }
  }
  return undefined
}

function containsImplicitMedia(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || (typeof Blob !== 'undefined' && value instanceof Blob)) return true
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  if ('type' in value && ['data', 'url', 'provider-file'].includes(String((value as { type?: unknown }).type))) return true
  if (Array.isArray(value)) return value.some((entry) => containsImplicitMedia(entry, seen))
  return Object.values(value as Record<string, unknown>).some((entry) => containsImplicitMedia(entry, seen))
}

/** Whole-value projection — the legacy `cassette.middleware()` path. */
function projectValue(result: unknown): unknown {
  if (containsImplicitMedia(result)) return undefined
  const value = toSerializable(result)
  if (value === undefined) return undefined
  return { status: 'value', value }
}

/** Revive a recorded payload into the shape the executor consumes. */
function reviveResult(payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  if (payload.status === 'complete' || payload.status === 'ok') {
    // Replay cannot reproduce the SDK's raw result object.
    return { ...payload, raw: undefined }
  }
  if (payload.status === 'invalid') {
    return {
      status: 'invalid',
      rawText: payload.rawText,
      error: new z.ZodError((payload.issues ?? []) as never),
    }
  }
  if (payload.status === 'value') return payload.value
  if (payload.status === 'thrown') {
    const { error } = safeThrownEnvelope(payload)
    throw new CassetteRecordedError(error.name, error.message)
  }
  return payload
}

function safeThrownEnvelope(payload: unknown): {
  status: 'thrown'
  error: { name: string; message: string }
} {
  if (
    isRecord(payload) &&
    payload.status === 'thrown' &&
    isRecord(payload.error)
  ) {
    const { name, message } = payload.error
    if (
      typeof name === 'string' &&
      typeof message === 'string' &&
      name !== REDACTED &&
      message !== REDACTED
    ) {
      return { status: 'thrown', error: { name, message } }
    }
  }
  return {
    status: 'thrown',
    error: { name: 'CassetteRecordedError', message: 'Recorded thrown value' },
  }
}

function safeThrownMessage(value: unknown): string {
  try {
    return sanitizeRecordedErrorMessage(String(value))
  } catch {
    return 'Unstringifiable thrown value'
  }
}

function safeErrorName(error: Error): string {
  try {
    return typeof error.name === 'string' && error.name.trim() !== ''
      ? error.name
      : 'Error'
  } catch {
    return 'Error'
  }
}

function safeErrorMessage(error: Error): string {
  try {
    return sanitizeRecordedErrorMessage(error.message)
  } catch {
    return 'Unreadable Error message'
  }
}

function sanitizeRecordedErrorMessage(message: string): string {
  return redactSensitiveText(message).slice(0, 1_000)
}

// ─────────────────────────────────────────────────────────────────
// SDK version (cassette metadata)
// ─────────────────────────────────────────────────────────────────

let cachedSdkVersion: string | undefined

async function sdkVersion(): Promise<string> {
  if (cachedSdkVersion !== undefined) return cachedSdkVersion
  for (const candidate of ['../../package.json', '../../../package.json']) {
    try {
      const url = new URL(candidate, import.meta.url)
      const parsed = JSON.parse(await readFile(url, 'utf8')) as {
        name?: unknown
        version?: unknown
      }
      if (parsed.name === '@use-crux/core' && typeof parsed.version === 'string') {
        cachedSdkVersion = parsed.version
        return cachedSdkVersion
      }
    } catch {
      // try the next candidate
    }
  }
  cachedSdkVersion = 'unknown'
  return cachedSdkVersion
}

// ─────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────

export interface CassetteSessionOptions {
  /** Cassette file path (see {@link cassettePath}). */
  path: string
  /** Effective replay mode; `'live'` sessions are never opened. */
  mode: Exclude<ReplayMode, 'live'>
  /** Custom match key (the `cassette()` `match` option). */
  match?: (call: NormalizedCall) => string
  /** Configured dot-path redaction (always-on defaults apply regardless). */
  redactPaths?: readonly string[]
}

export interface CassetteSession {
  /** The {@link GenerationInterceptor} implementation for this session. */
  intercept(call: InterceptedGeneration, execute: () => Promise<unknown>): Promise<unknown>
  /**
   * Whole-value record/replay against an explicit call identity — the legacy
   * `cassette.middleware()` path. Values must be JSON-serializable to be
   * recorded; non-serializable results pass through live.
   */
  interceptValue(identity: NormalizedCall, execute: () => Promise<unknown>): Promise<unknown>
  /** Persist recorded entries (no-op when nothing was recorded). */
  flush(): Promise<void>
  /** The file-level `recordedAt` when it exceeds the staleness window. */
  readonly staleSince: string | undefined
  /** Replay/record bookkeeping for reporting. */
  readonly stats: { hits: number; misses: number; recorded: number }
  /** Observability identity of the run that originally recorded this cassette. */
  readonly recorded: { runId: string; traceId: string; recordedAt: string } | undefined
  /** The cassette file path (for messages and reporting). */
  readonly path: string
}

/** Open a cassette session: load the file (absent → empty) and bind the mode. */
export async function openCassetteSession(options: CassetteSessionOptions): Promise<CassetteSession> {
  const { path, mode } = options
  const redactPaths = options.redactPaths ?? []
  const keyFor = (normalized: NormalizedCall): string =>
    options.match !== undefined
      ? options.match(normalized)
      : sha256Hex(canonicalJson(normalized))

  let file: CassetteFile = emptyCassetteFile(await sdkVersion())
  let staleSince: string | undefined
  let loaded: CassetteFile | undefined
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as CassetteFile
    if (parsed.version === 1 && isRecord(parsed.entries)) {
      loaded = parsed
    }
  } catch {
    // Absent or unreadable → start empty. replay-strict misses communicate.
  }
  if (loaded !== undefined) {
    validateCassetteEntries(loaded, path, keyFor)
    file = loaded
    const recordedAt = Date.parse(loaded.metadata?.recordedAt ?? '')
    if (
      !Number.isNaN(recordedAt) &&
      Date.now() - recordedAt > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000
    ) {
      staleSince = loaded.metadata.recordedAt
    }
  }

  const stats = { hits: 0, misses: 0, recorded: 0 }
  let dirty = false
  /** Keys refreshed this run — `refresh` re-records each exercised call once. */
  const refreshed = new Set<string>()
  /** In-flight live recordings keyed by normalized cassette key. */
  const pending = new Map<string, Promise<unknown>>()

  async function executeAndRecord(
    key: string,
    normalized: NormalizedCall,
    kind: CassetteEntry['kind'],
    execute: () => Promise<unknown>,
    project: (result: unknown) => unknown,
  ): Promise<unknown> {
    let result: unknown
    try {
      result = await execute()
    } catch (error) {
      const safeError =
        error instanceof Error
          ? {
              name: safeErrorName(error),
              message: safeErrorMessage(error),
            }
          : { name: 'NonErrorThrow', message: safeThrownMessage(error) }
      const payload = { status: 'thrown', error: safeError }
      recordPayload(key, normalized, kind, payload)
      throw error
    }
    const payload = project(result)
    if (payload !== undefined) {
      recordPayload(key, normalized, kind, payload)
    }
    return result
  }

  function recordPayload(
    key: string,
    normalized: NormalizedCall,
    kind: CassetteEntry['kind'],
    payload: unknown,
  ): void {
    if (shouldQuarantineQualityWrite()) return
    const context = observe.captureContext()
    if (file.recorded === undefined && context !== undefined) {
      file.recorded = {
        runId: context.runId,
        traceId: context.traceId,
        recordedAt: new Date().toISOString(),
      }
    }
    const entry = applyRedaction(
      {
        kind,
        call: normalized,
        result: payload,
        recordedAt: new Date().toISOString(),
      },
      redactPaths,
    ) as CassetteEntry
    if (isRecord(payload) && payload.status === 'thrown') {
      entry.result = safeThrownEnvelope(entry.result)
    }
    file.entries[key] = entry
    const model = normalized.model
    if (model !== undefined && !file.metadata.models.includes(model))
      file.metadata.models.push(model)
    stats.recorded++
    refreshed.add(key)
    dirty = true
  }

  function executeAndRecordSingleFlight(
    key: string,
    normalized: NormalizedCall,
    kind: CassetteEntry['kind'],
    execute: () => Promise<unknown>,
    project: (result: unknown) => unknown,
  ): Promise<unknown> {
    const existing = pending.get(key)
    if (existing !== undefined) return existing
    const recording = executeAndRecord(key, normalized, kind, execute, project).finally(() => {
      pending.delete(key)
    })
    pending.set(key, recording)
    return recording
  }

  /** The shared mode logic both interception forms run through. */
  function interceptNormalized(
    normalized: NormalizedCall,
    kind: CassetteEntry['kind'],
    execute: () => Promise<unknown>,
    project: (result: unknown) => unknown,
  ): Promise<unknown> {
    const storedCall = applyRedaction(normalized, redactPaths) as NormalizedCall
    const key = keyFor(storedCall)
    const entry = file.entries[key]

    if (mode === 'refresh') {
      // Re-record every exercised call once per run; replay repeats within
      // the same run (trials of one cell stay self-consistent).
      if (refreshed.has(key) && entry !== undefined) {
        stats.hits++
        return Promise.resolve(reviveResult(entry.result))
      }
      return executeAndRecordSingleFlight(
        key,
        storedCall,
        kind,
        execute,
        project,
      )
    }

    if (entry !== undefined) {
      stats.hits++
      return Promise.resolve(reviveResult(entry.result))
    }

    if (mode === 'replay-strict') {
      stats.misses++
      throw new CassetteMissError(key, storedCall, path)
    }

    // record-new: miss → live + record.
    return executeAndRecordSingleFlight(key, storedCall, kind, execute, project)
  }

  return {
    path,
    get staleSince() {
      return staleSince
    },
    get recorded() {
      return file.recorded
    },
    stats,

    async intercept(call, execute) {
      const normalized = buildNormalizedCall(call)
      return interceptNormalized(normalized, call.kind, execute, projectResult)
    },

    async interceptValue(identity, execute) {
      return interceptNormalized(identity, 'value', execute, projectValue)
    },

    async flush() {
      if (!dirty) return
      await mkdir(dirname(path), { recursive: true })
      await withFileLock(path, async () => {
        const disk = readCassetteFileForMerge(path)
        if (disk !== undefined) validateCassetteEntries(disk, path, keyFor)
        file = mergeCassetteFiles(disk, file, path, refreshed)
        file.metadata.recordedAt = new Date().toISOString()
        file.metadata.sdkVersion = await sdkVersion()
        await writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`)
      })
      dirty = false
    },
  }
}

function readCassetteFileForMerge(path: string): CassetteFile | undefined {
  try {
    const raw = readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as CassetteFile
    return parsed.version === 1 && isRecord(parsed.entries) ? parsed : undefined
  } catch {
    return undefined
  }
}

function validateCassetteEntries(
  file: CassetteFile,
  path: string,
  keyFor: (call: NormalizedCall) => string,
): void {
  for (const [key, entry] of Object.entries(file.entries)) {
    if (
      !isRecord(entry) ||
      !isRecord(entry.call) ||
      keyFor(entry.call as NormalizedCall) !== key
    ) {
      throw new CassetteCorruptionError(path, key)
    }
  }
}

function mergeCassetteFiles(
  disk: CassetteFile | undefined,
  memory: CassetteFile,
  path: string,
  memoryWins: ReadonlySet<string>,
): CassetteFile {
  if (disk === undefined) return memory
  const entries: Record<string, CassetteEntry> = { ...memory.entries }
  for (const [key, diskEntry] of Object.entries(disk.entries)) {
    const memoryEntry = entries[key]
    if (memoryEntry !== undefined && JSON.stringify(memoryEntry) !== JSON.stringify(diskEntry)) {
      observe.event({
        name: 'cassette.conflict',
        attributes: { path, key },
      })
    }
    if (memoryWins.has(key)) continue
    entries[key] = diskEntry
  }
  const recorded = disk.recorded ?? memory.recorded
  return {
    version: 1,
    metadata: {
      recordedAt: memory.metadata.recordedAt,
      sdkVersion: memory.metadata.sdkVersion,
      models: [...new Set([...(disk.metadata?.models ?? []), ...memory.metadata.models])],
    },
    ...(recorded !== undefined ? { recorded } : {}),
    entries,
  }
}
