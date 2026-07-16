/** Schema-validated JSON, JSONL, and CSV Case loading for Eval discovery. */

import { readFile } from 'node:fs/promises'
import type * as EvalRunnerCore from '@use-crux/core/eval/internal/runner'
import type { DiscoveredEval, EvalRunner } from './eval-discovery'
import { EvalCaseFileError } from './eval-case-errors'
import { resolveAuthoredCaseFile } from './eval-case-path'
import {
  fingerprintEvalDefinition,
  insideProjectRoot,
  pathExists,
} from './eval-case-identity'

export { EvalCaseFileError } from './eval-case-errors'

type StandardSchema = EvalRunnerCore.EvalDefinitionV1['caseFiles'][number]['inputSchema']
type EvalCaseMetadata = NonNullable<EvalRunnerCore.RawEvalCase['metadata']>

export interface LoadedEvalCase {
  readonly id: string
  readonly origin: string
  readonly authored: EvalRunnerCore.RawEvalCase
  readonly unvalidatedExpected: boolean
}

export interface LoadCaseRowsOptions {
  readonly path: string
  readonly displayPath: string
  readonly kind: 'authored' | 'sidecar'
  readonly inputSchema: StandardSchema
  readonly expectedSchema?: StandardSchema
  readonly core: EvalRunner
}

export interface HydratedEval extends DiscoveredEval {
  readonly cases: readonly LoadedEvalCase[]
  readonly definitionFingerprint: string
  /** Canonical project-relative POSIX paths used by watch and registry hosts. */
  readonly caseFileDependencies: readonly string[]
  /** True when CLI Case selection intentionally omitted authored work. */
  readonly filteredSelection?: true
}

export interface EvalCaseHydrationOptions {
  readonly projectRoot: string
  readonly core: EvalRunner
  readonly registerWatchDependency?: (canonicalPath: string) => void
}

/** Merge authored sources in declaration order, then the canonical sibling. */
export async function hydrateEvalCases(
  discovered: DiscoveredEval,
  options: EvalCaseHydrationOptions,
): Promise<HydratedEval> {
  const definition = options.core.getEvalDefinitionForInternalUse(discovered.eval)
  const sidecarPath = insideProjectRoot(options.projectRoot, discovered.sidecarFile)
  const hasSidecar = await pathExists(sidecarPath)
  const hasFiles = definition.caseFiles.length > 0
  const schemas = options.core.getEvalTaskSchemasForInternalUse(discovered.eval)
  if ((hasSidecar || hasFiles) && schemas.inputSchema === undefined) {
    throw new EvalCaseFileError(
      discovered.sourceKey.relativeFile,
      'file-backed Cases require a managed task with an input Standard Schema',
    )
  }

  const merged: LoadedEvalCase[] = []
  const caseFileDependencies: string[] = []
  for (const position of definition.caseSourceOrder) {
    if (position.kind === 'inline') {
      const authored = definition.cases[position.index]!
      merged.push(
        Object.freeze({
          id: authored.id ?? options.core.fingerprintEvalValueForInternalUse(authored.input),
          origin: `${discovered.sourceKey.relativeFile}:inline:${position.index + 1}`,
          authored,
          unvalidatedExpected: false,
        }),
      )
      continue
    }
    const reference = definition.caseFiles[position.index]!
    const resolved = await resolveAuthoredCaseFile({
      projectRoot: options.projectRoot,
      sourceFile: discovered.sourceKey.relativeFile,
      sidecarFile: discovered.sidecarFile,
      authoredPath: reference.path,
      registerWatchDependency: (canonicalPath) => {
        caseFileDependencies.push(canonicalPath)
        options.registerWatchDependency?.(canonicalPath)
      },
    })
    merged.push(
      ...(await loadCaseRows({
        path: resolved.absolutePath,
        displayPath: resolved.canonicalPath,
        kind: 'authored',
        inputSchema: reference.inputSchema,
        ...(reference.expectedSchema !== undefined ? { expectedSchema: reference.expectedSchema } : {}),
        core: options.core,
      })),
    )
  }
  if (hasSidecar) {
    merged.push(
      ...(await loadCaseRows({
        path: sidecarPath,
        displayPath: discovered.sidecarFile,
        kind: 'sidecar',
        inputSchema: schemas.inputSchema!,
        core: options.core,
      })),
    )
  }
  assertUniqueCaseIds(merged)
  const definitionFingerprint = await fingerprintEvalDefinition(
    discovered,
    definition,
    merged,
    caseFileDependencies,
    options,
  )
  return Object.freeze({
    ...discovered,
    eval: options.core.materializeEvalForInternalUse(discovered.eval, {
      id: discovered.id,
      cases: merged.map((entry) => entry.authored),
    }),
    cases: Object.freeze(merged),
    caseFileDependencies: Object.freeze(caseFileDependencies),
    definitionFingerprint,
  })
}

/** Read and validate one data-only Case source without invoking Eval logic. */
export async function loadCaseRows(options: LoadCaseRowsOptions): Promise<readonly LoadedEvalCase[]> {
  const text = await readFile(options.path, 'utf8').catch((error: unknown) => {
    throw new EvalCaseFileError(options.displayPath, `cannot read file (${errorMessage(error)})`)
  })
  const parsed = parseRows(text, options.displayPath)
  const loaded: LoadedEvalCase[] = []

  for (const row of parsed) loaded.push(await normalizeRow(row, options))
  assertUniqueCaseIds(loaded)
  return Object.freeze(loaded)
}

interface ParsedRow {
  readonly value: unknown
  readonly line: number
}

function parseRows(text: string, path: string): readonly ParsedRow[] {
  try {
    if (path.endsWith('.jsonl')) {
      return text.split(/\r?\n/).flatMap((line, index) =>
        line.trim() === '' ? [] : [{ value: JSON.parse(line) as unknown, line: index + 1 }],
      )
    }
    if (path.endsWith('.csv')) return parseCsv(text)
    if (path.endsWith('.json')) {
      const value = JSON.parse(text) as unknown
      if (!Array.isArray(value)) throw new EvalCaseFileError(path, 'JSON Case files must contain an array of rows')
      return value.map((row, index) => ({ value: row, line: index + 1 }))
    }
    throw new EvalCaseFileError(path, 'supported extensions are .json, .jsonl, and .csv')
  } catch (error) {
    if (error instanceof EvalCaseFileError) throw error
    throw new EvalCaseFileError(path, `invalid serialized row (${errorMessage(error)})`)
  }
}

function parseCsv(text: string): readonly ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length === 0) return []
  const headers = lines[0]!.split(',').map((header) => header.trim())
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',').map((cell) => cell.trim())
    return {
      line: index + 2,
      value: Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] ?? ''])),
    }
  })
}

async function normalizeRow(row: ParsedRow, options: LoadCaseRowsOptions): Promise<LoadedEvalCase> {
  const origin = `${options.displayPath}:${row.line}`
  if (!isRecord(row.value)) throw new EvalCaseFileError(origin, 'row must be a JSON object')
  const record = row.value
  if (options.kind === 'sidecar') assertReviewCaseRow(record, origin)
  if (record.expect !== undefined || record.afterScores !== undefined) {
    throw new EvalCaseFileError(origin, 'file-backed Cases are data only and cannot contain callbacks')
  }

  const inputSource = record.input !== undefined ? record.input : record
  const input = await validateSchema(options.inputSchema, inputSource, origin, 'input')
  const expected = record.expected === undefined
    ? undefined
    : options.expectedSchema === undefined
      ? record.expected
      : await validateSchema(options.expectedSchema, record.expected, origin, 'expected')
  const authored: EvalRunnerCore.RawEvalCase = Object.freeze({
    ...(typeof record.id === 'string' ? { id: record.id } : {}),
    ...(typeof record.name === 'string' ? { name: record.name } : {}),
    input,
    ...(record.call !== undefined ? { call: record.call } : {}),
    ...(expected !== undefined ? { expected } : {}),
    ...(expected !== undefined && options.expectedSchema === undefined
      ? { unvalidatedExpected: true as const }
      : {}),
    ...(typeof record.trials === 'number' ? { trials: record.trials } : {}),
    ...(Array.isArray(record.tags) ? { tags: Object.freeze([...record.tags]) as readonly string[] } : {}),
    ...(isRecord(record.metadata)
      ? { metadata: Object.freeze({ ...record.metadata }) as EvalCaseMetadata }
      : {}),
    ...(typeof record.skip === 'boolean' || typeof record.skip === 'string' ? { skip: record.skip } : {}),
    ...(typeof record.only === 'boolean' ? { only: record.only } : {}),
  })
  const id = authored.id ?? options.core.fingerprintEvalValueForInternalUse(input)
  if (id.trim() === '') throw new EvalCaseFileError(origin, 'Case id must be a non-empty string')
  return Object.freeze({
    id,
    origin,
    authored,
    unvalidatedExpected: expected !== undefined && options.expectedSchema === undefined,
  })
}

async function validateSchema(schema: StandardSchema, value: unknown, origin: string, field: string): Promise<unknown> {
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) {
    throw new EvalCaseFileError(origin, `${field} failed schema validation: ${result.issues.map((issue) => issue.message).join('; ')}`)
  }
  return result.value
}

function assertReviewCaseRow(row: Readonly<Record<string, unknown>>, origin: string): void {
  const metadata = row.metadata
  if (
    row.schemaVersion !== 1 ||
    typeof row.id !== 'string' || row.id.trim() === '' ||
    row.input === undefined ||
    !isRecord(metadata) ||
    metadata.source !== 'review' ||
    typeof metadata.reviewId !== 'string' ||
    typeof metadata.runId !== 'string' ||
    typeof metadata.addedAt !== 'string'
  ) {
    throw new EvalCaseFileError(origin, 'row does not match ReviewCaseRowV1')
  }
  if (row.name !== undefined && typeof row.name !== 'string') throw new EvalCaseFileError(origin, 'name must be a string')
  if (row.tags !== undefined && (!Array.isArray(row.tags) || !row.tags.every((tag) => typeof tag === 'string'))) {
    throw new EvalCaseFileError(origin, 'tags must be an array of strings')
  }
}

/** Reject collisions across any already-merged inline or file Case sources. */
export function assertUniqueCaseIds(cases: readonly LoadedEvalCase[]): void {
  const seen = new Map<string, string>()
  for (const entry of cases) {
    const previous = seen.get(entry.id)
    if (previous !== undefined) {
      throw new EvalCaseFileError(entry.origin, `duplicate Case id '${entry.id}' from ${previous} and ${entry.origin}`)
    }
    seen.set(entry.id, entry.origin)
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
