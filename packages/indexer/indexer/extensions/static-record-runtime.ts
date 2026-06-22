import type { StaticObjectValue, StaticSourceMatch, StaticSyntaxFileRecord } from '../static/syntax-record/types'
import {
  createStaticSyntaxInitializerMap,
  staticObjectValue,
  type StaticSyntaxInitializerMap,
} from '../static/syntax-record/value'
import type { IndexExtractor } from './types'
import {
  extractorsForCall,
  extractorsForNew,
  extractorsForObject,
  type ExtensionRegistry,
  type RegisteredExtractor,
} from './registry'
import type { StaticExtractionResult } from './runtime'
import { runtimeResultFromExtractResult } from './runtime-results'
import { createStaticRecordExtractContext } from './static-record-context'

/** Record-backed static extraction input consumed by native-ready runtime adapters. */
export interface StaticRecordExtractionInput {
  /** Project root used for deterministic local ids. */
  readonly root: string
  /** Backend-neutral syntax record for the current file. */
  readonly record: StaticSyntaxFileRecord
  /** Source match from `record.matches` to run through extension dispatch. */
  readonly match: StaticSourceMatch
  /** Already parsed syntax records keyed by absolute file path for direct import source refs. */
  readonly recordsByFile?: ReadonlyMap<string, StaticSyntaxFileRecord>
  /** Compiler-owned extractor identities that a native fact packet already replaced. */
  readonly skipExtractors?: readonly StaticRecordExtractorIdentity[]
}

/** Extractor identity used to skip bundled TS extractors replaced by native facts. */
export interface StaticRecordExtractorIdentity {
  readonly extension: string
  readonly extractor: string
}

/**
 * Executes eligible static extractors against a syntax record match.
 *
 * This is the Phase 10 runtime seam for native syntax frontends: parser-specific AST memory is gone
 * before extractors run, and extension authors keep seeing the same stable `ExtractContext` readers.
 */
export function extractStaticRecordWithRegistry(
  registry: ExtensionRegistry,
  input: StaticRecordExtractionInput,
): StaticExtractionResult {
  const registered = extractorsForStaticRecordMatch(registry, input.match).filter(
    (item) => !shouldSkipExtractor(item, input.skipExtractors),
  )
  if (registered.length === 0) return { kind: 'no-match' }

  const initializerRecords = [...input.record.localInitializers, ...(input.match.localInitializers ?? [])]
  const initializers = createStaticSyntaxInitializerMap(initializerRecords)
  let noneResult: Extract<StaticExtractionResult, { readonly kind: 'none' }> | undefined
  for (const item of registered) {
    const objectArg = objectArgForExtractor(input.match, item.extractor, initializers)
    const result = item.extractor.extract(
      createStaticRecordExtractContext({
        root: input.root,
        record: input.record,
        match: input.match,
        initializers,
        extension: item.extension,
        extractor: item.extractor,
        initializerRecords,
        recordsByFile: input.recordsByFile,
        ...(objectArg ? { objectArg } : {}),
      }),
    )
    const runtimeResult = runtimeResultFromExtractResult(item, result)
    if (runtimeResult.kind !== 'none') return runtimeResult
    noneResult ??= runtimeResult
  }

  return noneResult ?? { kind: 'no-match' }
}

function shouldSkipExtractor(
  item: RegisteredExtractor,
  skipExtractors: readonly StaticRecordExtractorIdentity[] | undefined,
): boolean {
  if (!skipExtractors || skipExtractors.length === 0) return false
  return skipExtractors.some((skip) => skip.extension === item.extension.name && skip.extractor === item.extractor.name)
}

function extractorsForStaticRecordMatch(
  registry: ExtensionRegistry,
  match: StaticSourceMatch,
): readonly RegisteredExtractor[] {
  switch (match.kind) {
    case 'object':
      return extractorsForObject(registry)
    case 'call':
      return extractorsForCall(registry, match.callee.name, match.callee.moduleSpecifier, match.callee.importedName)
    case 'new':
      return extractorsForNew(registry, match.callee.name)
    default:
      return assertNever(match)
  }
}

function objectArgForExtractor(
  match: StaticSourceMatch,
  extractor: IndexExtractor,
  initializers: StaticSyntaxInitializerMap,
): StaticObjectValue | undefined {
  if (match.kind === 'object') return match.object
  const configArg = extractorConfigArg(match, extractor)
  if (configArg !== undefined) return staticObjectValue(match.args[configArg], initializers) ?? match.objectArg
  return match.objectArg
}

function extractorConfigArg(match: StaticSourceMatch, extractor: IndexExtractor): number | undefined {
  if (match.kind === 'object') return undefined
  for (const pattern of extractor.patterns) {
    if (pattern.kind !== match.kind) continue
    if (!patternMatchesCallee(pattern, match)) continue
    return pattern.configArg
  }
  return undefined
}

function patternMatchesCallee(
  pattern: Extract<IndexExtractor['patterns'][number], { readonly kind: 'call' | 'new' }>,
  match: Extract<StaticSourceMatch, { readonly kind: 'call' | 'new' }>,
): boolean {
  const patternName = pattern.importFrom ? (match.callee.importedName ?? match.callee.name) : match.callee.name
  return (
    pattern.name === patternName &&
    (!pattern.importFrom ||
      (match.callee.moduleSpecifier !== undefined && pattern.importFrom.includes(match.callee.moduleSpecifier)))
  )
}

function assertNever(value: never): never {
  throw new Error(`Unhandled static record match: ${JSON.stringify(value)}`)
}
