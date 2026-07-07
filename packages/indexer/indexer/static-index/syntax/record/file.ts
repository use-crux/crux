import { readFile } from 'node:fs/promises'
import type { ExtractedFacts, IndexerExtensionRuntime } from '../../../extensions'
import { staticFoundDefinitionFromExtractedFacts } from '../../compatibility/syntax-record-bridge/normalizer'
import type { StaticFoundDefinition } from '../../../types'
import type { ParseMemo } from '../../../static/extraction/source-io'
import { withStaticExtractionTiming, type StaticExtractionInstrumentation } from '../../../static/instrumentation'
import type { StaticFactParseResult } from '../../../static/types'
import { createTypeScriptStaticSyntaxFrontend } from './typescript-frontend'
import { staticRecordRuntimePrepareFacts } from './runtime-prepare'
import { staticRecordTreePathDefinitions } from './tree-paths'
import type { StaticRecordProjectionCache } from './projection-cache'
import type { StaticSourceMatch, StaticSyntaxFileRecord, StaticSyntaxFrontend } from './types'
import { importedDefinitionsForFactRelations } from './imported-definitions'
import {
  createNativeFactIndex,
  extractedFacts,
  type NativeFactIndex,
  type NativeFactProjectionMode,
} from './native-facts'

/** Input for the syntax-record-backed static fact parser. */
export interface StaticRecordFactParseInput {
  /** Project root used by source records and extractor contexts. */
  readonly root: string
  /** Absolute source file to extract. */
  readonly file: string
  /** Extension runtime used to execute stable extractors. */
  readonly runtime: IndexerExtensionRuntime
  /** Syntax frontend. Defaults to the TypeScript-backed record producer. */
  readonly frontend?: StaticSyntaxFrontend
  /** Optional pass-local source memo shared with callers. */
  readonly parseMemo?: ParseMemo
  /** Optional compiler-owned timing hooks for benchmark and diagnostics. */
  readonly instrumentation?: StaticExtractionInstrumentation
  /** Optional pass-local projection cache shared across files. */
  readonly projectionCache?: StaticRecordProjectionCache
  /**
   * Controls whether native fact packets are emitted by this parser result.
   *
   * Defaults to `inline`, which preserves the historical combined projection.
   * Native parser hosts can use `external` for the TypeScript extractor lane or
   * `native-only` for a native packet lane without changing extractor dispatch.
   */
  readonly nativeFactProjection?: NativeFactProjectionMode
}

/**
 * Parses one source file through backend-neutral syntax records.
 *
 * This is the Phase 10 file-level adapter. It mirrors the fact-first shape returned by the existing
 * TypeScript AST parser while keeping extractor execution behind `StaticSyntaxFileRecord` values.
 */
export async function parseStaticFactsFromSyntaxRecords(
  input: StaticRecordFactParseInput,
): Promise<StaticFactParseResult> {
  const nativeFactProjection = input.nativeFactProjection ?? 'inline'
  const frontend =
    input.frontend ?? createTypeScriptStaticSyntaxFrontend({ callNames: input.runtime.manifest.callNames })
  const record = await withStaticExtractionTiming(
    input.instrumentation,
    'static.syntax_record.parse_file',
    input.file,
    () => syntaxRecordForFile(input.root, input.file, frontend, input.parseMemo),
  )
  const cache = cachedRecordReader(input.root, frontend, input.parseMemo, record)
  await withStaticExtractionTiming(input.instrumentation, 'static.syntax_record.preload_imports', input.file, () =>
    preloadImportedRecords(record, cache.readRecord),
  )
  const nativeFactsByMatchIndex = createNativeFactIndex(record)
  const { exported, discovered } = await withStaticExtractionTiming(
    input.instrumentation,
    'static.syntax_record.extract_matches',
    input.file,
    () => {
      const exported = extractRecordMatches(
        input.root,
        input.runtime,
        record,
        cache.recordsByFile,
        nativeFactsByMatchIndex,
        nativeFactProjection,
        (match) => match.exported,
        new Set(),
      )
      const seen = new Set(exported.found.map((item) => item.definition.id))
      const discovered = extractRecordMatches(
        input.root,
        input.runtime,
        record,
        cache.recordsByFile,
        nativeFactsByMatchIndex,
        nativeFactProjection,
        (match) => !match.exported,
        seen,
      )
      return { exported, discovered }
    },
  )
  const runtimePrepareFacts = nativeFactProjection === 'native-only' ? [] : staticRecordRuntimePrepareFacts(record)
  const facts = [...exported.facts, ...discovered.facts, ...runtimePrepareFacts]
  const foundForPathProjection = [...exported.found, ...discovered.found]
  const pathDefinitions = await withStaticExtractionTiming(
    input.instrumentation,
    'static.syntax_record.tree_paths',
    input.file,
    () =>
      staticRecordTreePathDefinitions({
        root: input.root,
        record,
        runtime: input.runtime,
        found: foundForPathProjection,
        readRecord: cache.readRecord,
      }),
  )
  const importedDefinitions = await withStaticExtractionTiming(
    input.instrumentation,
    'static.syntax_record.imported_definitions',
    input.file,
    () =>
      importedDefinitionsForFactRelations({
        root: input.root,
        runtime: input.runtime,
        record,
        readRecord: cache.readRecord,
        projectionCache: input.projectionCache,
        nativeFactProjection,
      }),
  )
  const diagnostics = [...record.diagnostics, ...facts.flatMap((fact) => fact.diagnostics ?? [])]
  const dependencies = [
      ...new Set([
      ...record.imports.flatMap((item) => (item.importKind === 'type' ? [] : (item.resolvedFile ?? []))),
      ...facts.flatMap((fact) =>
        (fact.dependencies ?? [])
          .filter((dependency) => dependency.kind === 'source-file')
          .map((dependency) => dependency.file),
      ),
    ]),
  ].sort()

  return { facts, pathDefinitions, importedDefinitions, diagnostics, dependencies }
}

async function syntaxRecordForFile(
  root: string,
  file: string,
  frontend: StaticSyntaxFrontend,
  parseMemo?: ParseMemo,
): Promise<StaticSyntaxFileRecord> {
  const source = parseMemo ? await parseMemo.readSource(file) : await readFile(file, 'utf8')
  return frontend.parseFile({ root, file, source })
}

function cachedRecordReader(
  root: string,
  frontend: StaticSyntaxFrontend,
  parseMemo: ParseMemo | undefined,
  initialRecord: StaticSyntaxFileRecord,
): {
  readonly recordsByFile: Map<string, StaticSyntaxFileRecord>
  readonly readRecord: (file: string) => Promise<StaticSyntaxFileRecord>
} {
  const recordsByFile = new Map([[initialRecord.file, initialRecord]])
  return {
    recordsByFile,
    readRecord: async (file) => {
      const cached = recordsByFile.get(file)
      if (cached) return cached
      const record = await syntaxRecordForFile(root, file, frontend, parseMemo)
      recordsByFile.set(file, record)
      return record
    },
  }
}

function extractRecordMatches(
  root: string,
  runtime: IndexerExtensionRuntime,
  record: StaticSyntaxFileRecord,
  recordsByFile: ReadonlyMap<string, StaticSyntaxFileRecord>,
  nativeFactsByMatchIndex: NativeFactIndex,
  nativeFactProjection: NativeFactProjectionMode,
  predicate: (match: StaticSourceMatch) => boolean,
  seenDefinitionIds: Set<string>,
): { readonly facts: ExtractedFacts[]; readonly found: StaticFoundDefinition[] } {
  const facts: ExtractedFacts[] = []
  const found: StaticFoundDefinition[] = []
  for (const [matchIndex, match] of record.matches.entries()) {
    if (!predicate(match)) continue
    const nativeFacts = nativeFactsByMatchIndex.get(matchIndex)
    const runtimeFacts =
      nativeFactProjection === 'native-only'
        ? []
        : extractedFacts(
            runtime.extractStaticRecord({
              root,
              record,
              match,
              recordsByFile,
              skipExtractors: nativeFacts?.replacedExtractors,
            }),
          )
    const nativeOutputFacts = nativeFactProjection === 'external' ? [] : (nativeFacts?.facts ?? [])
    const extractedForMatch = [...nativeOutputFacts, ...runtimeFacts]
    if (extractedForMatch.length === 0) continue
    const extractedWithNewDefinitions: ExtractedFacts[] = []
    const foundForMatch: StaticFoundDefinition[] = []
    for (const extracted of extractedForMatch) {
      const item = staticFoundDefinitionFromExtractedFacts(extracted)
      if (!item) {
        extractedWithNewDefinitions.push(extracted)
        continue
      }
      if (seenDefinitionIds.has(item.definition.id)) continue
      extractedWithNewDefinitions.push(extracted)
      foundForMatch.push(item)
    }
    if (extractedWithNewDefinitions.length === 0) continue
    for (const item of foundForMatch) seenDefinitionIds.add(item.definition.id)
    facts.push(...extractedWithNewDefinitions)
    found.push(...foundForMatch)
  }
  return { facts, found }
}

async function preloadImportedRecords(
  record: StaticSyntaxFileRecord,
  readRecord: (file: string) => Promise<StaticSyntaxFileRecord>,
): Promise<void> {
  await Promise.all(
    record.imports.flatMap((importRecord) =>
      importRecord.resolvedFile ? [safeReadRecord(readRecord, importRecord.resolvedFile)] : [],
    ),
  )
}

async function safeReadRecord(
  readRecord: (file: string) => Promise<StaticSyntaxFileRecord>,
  file: string,
): Promise<StaticSyntaxFileRecord | undefined> {
  try {
    return await readRecord(file)
  } catch {
    return undefined
  }
}
