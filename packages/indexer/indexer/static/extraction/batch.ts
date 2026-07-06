import type { IndexerExtensionRuntime } from '../../extensions'
import { mapBounded } from '../../pipeline'
import type { SemanticSourceProfileFile } from '../../semantic/source-profile'
import { staticParseResultFromFacts } from '../file'
import { withStaticExtractionTiming, type StaticExtractionInstrumentation } from '../instrumentation'
import {
  createProvidedStaticSyntaxFrontend,
  createStaticRecordProjectionCache,
  parseStaticFactsFromSyntaxRecords,
  type NativeFactProjectionMode,
  type StaticSyntaxFileInput,
  type StaticSyntaxFileRecord,
  type StaticSyntaxFrontend,
} from '../../static-index/syntax/record'
import { cacheStateForParsedBatchMiss, staticCacheWriteConcurrency } from './batch-cache'
import { cacheMissRecordBatchSize, chunksOf } from './batch-utils'
import { createStaticParseCacheKeyContext, type StaticParseCacheKeyContext } from './cache-key'
import { createStaticCacheWriteQueue, type StaticCacheWriteQueue } from './cache-write-queue'
import { createParseMemo, type ParseMemo, type SourceReader } from './source-io'
import type { StaticFileExtraction, StaticParseCacheEntryMetadata, StaticParseCacheStore } from './types'

interface BatchExtractionCacheInput {
  readonly store: StaticParseCacheStore
  readonly compilerInputs: readonly unknown[]
  readonly missRecordBatchSize?: number
  readonly hitsByFile?: ReadonlyMap<string, string>
}

export interface BatchExtractionInput {
  readonly root: string
  readonly files: readonly string[]
  readonly runtime: IndexerExtensionRuntime
  readonly syntaxFrontend: StaticSyntaxFrontend & Required<Pick<StaticSyntaxFrontend, 'parseFiles'>>
  readonly sources: SourceReader
  readonly concurrency: number
  readonly instrumentation: StaticExtractionInstrumentation | undefined
  readonly nativeFactProjection?: NativeFactProjectionMode
  readonly cache?: BatchExtractionCacheInput
}

interface BatchExtractionInputWithCache extends BatchExtractionInput {
  readonly cache: BatchExtractionCacheInput
}

interface PreparedBatchFile {
  readonly index: number
  readonly file: string
  readonly semanticProfile: SemanticSourceProfileFile | undefined
  readonly cacheKey?: string
  readonly cacheMetadata?: StaticParseCacheEntryMetadata
  readonly cached?: StaticFileExtraction
}

interface ParsedBatchMiss {
  readonly index: number
  readonly result: StaticFileExtraction
}

/**
 * Extracts many files through a frontend-owned batch parse.
 *
 * With caching enabled, the batch parse is restricted to cache misses. This is
 * the static-index production path: Rust/Go can deliver syntax records in one
 * transport batch while Node still owns projection, extension execution, and
 * cache correctness.
 */
export async function extractFilesWithBatchFrontend(
  input: BatchExtractionInput,
): Promise<readonly StaticFileExtraction[]> {
  if (hasBatchExtractionCache(input)) return extractFilesWithBatchFrontendAndCache(input)
  return extractFilesWithBatchFrontendWithoutCache(input)
}

export async function parseWithRecordMemo(
  root: string,
  file: string,
  runtime: IndexerExtensionRuntime,
  syntaxFrontend: StaticSyntaxFrontend,
  parseMemo: ParseMemo,
  instrumentation: StaticExtractionInstrumentation | undefined,
  projectionCache?: ReturnType<typeof createStaticRecordProjectionCache>,
  nativeFactProjection?: NativeFactProjectionMode,
): Promise<Omit<StaticFileExtraction, 'file' | 'fromCache'>> {
  return staticParseResultFromFacts(
    await withStaticExtractionTiming(instrumentation, 'static.syntax_records.total', file, () =>
      parseStaticFactsFromSyntaxRecords({
        root,
        file,
        runtime,
        frontend: syntaxFrontend,
        parseMemo,
        instrumentation,
        projectionCache,
        nativeFactProjection,
      }),
    ),
  )
}
export async function semanticProfileForFile(
  file: string,
  parseMemo: ParseMemo,
): Promise<SemanticSourceProfileFile | undefined> {
  try {
    return (await parseMemo.readSourceInfo(file)).semanticProfile
  } catch {
    return undefined
  }
}

async function extractFilesWithBatchFrontendWithoutCache(
  input: BatchExtractionInput,
): Promise<readonly StaticFileExtraction[]> {
  const parseMemo = createParseMemo(input.sources)
  const projectionCache = createStaticRecordProjectionCache()
  const records = await parseBatchRecords(input, input.files, parseMemo)
  const providedFrontend = createProvidedStaticSyntaxFrontend({
    records,
    identity: input.syntaxFrontend.identity,
    fallback: input.syntaxFrontend,
  })
  return mapBounded(input.files, input.concurrency, async (file) =>
    withStaticExtractionTiming(input.instrumentation, 'static.extract_file.total', file, async () => {
      const semanticProfile = await withStaticExtractionTiming(
        input.instrumentation,
        'static.semantic_profile',
        file,
        () => semanticProfileForFile(file, parseMemo),
      )
      const parsed = await parseWithRecordMemo(
        input.root,
        file,
        input.runtime,
        providedFrontend,
        parseMemo,
        input.instrumentation,
        projectionCache,
        input.nativeFactProjection,
      )
      return Object.freeze({ file, ...parsed, semanticProfile, fromCache: false })
    }),
  )
}

async function extractFilesWithBatchFrontendAndCache(
  input: BatchExtractionInputWithCache,
): Promise<readonly StaticFileExtraction[]> {
  const parseMemo = createParseMemo(input.sources)
  const projectionCache = createStaticRecordProjectionCache()
  const cacheKeyContext = createStaticParseCacheKeyContext(input.root)
  const cacheWriteQueue = createStaticCacheWriteQueue(staticCacheWriteConcurrency(input.concurrency))
  try {
    const prepared = await mapBounded(input.files, input.concurrency, (file, index) =>
      prepareBatchFile(input, parseMemo, file, index),
    )
    const results = new Array<StaticFileExtraction | undefined>(input.files.length)
    const misses: PreparedBatchFile[] = []

    for (const item of prepared) {
      if (item.cached) {
        results[item.index] = item.cached
      } else {
        misses.push(item)
      }
    }
    if (misses.length > 0) {
      for (const chunk of chunksOf(misses, cacheMissRecordBatchSize(input.cache))) {
        const records = await parseBatchRecords(
          input,
          chunk.map((item) => item.file),
          parseMemo,
        )
        const recordsByFile = new Map(records.map((record) => [record.file, record] as const))
        const providedFrontend = createProvidedStaticSyntaxFrontend({
          records,
          identity: input.syntaxFrontend.identity,
          fallback: input.syntaxFrontend,
        })
        const parsedMisses = await mapBounded(chunk, input.concurrency, (item) =>
          parseBatchMiss(
            input,
            parseMemo,
            providedFrontend,
            item,
            recordsByFile,
            cacheKeyContext,
            cacheWriteQueue,
            projectionCache,
          ),
        )
        for (const item of parsedMisses) results[item.index] = item.result
      }
    }

    return results.map((result, index) => {
      if (!result) throw new Error(`Static batch extraction did not produce a result for ${input.files[index]}`)
      return result
    })
  } finally {
    await cacheWriteQueue.drain()
  }
}

async function prepareBatchFile(
  input: BatchExtractionInputWithCache,
  parseMemo: ParseMemo,
  file: string,
  index: number,
): Promise<PreparedBatchFile> {
  const cacheHit = input.cache.hitsByFile?.get(file)
  if (cacheHit) {
    const cached = await withStaticExtractionTiming(input.instrumentation, 'static.cache.read', file, () =>
      input.cache.store.get(cacheHit),
    )
    if (cached?.semanticProfile) return { index, file, semanticProfile: cached.semanticProfile, cacheKey: cacheHit, cached }
    if (cached) {
      const semanticProfile = await sourceProfileForPreparedFile(input, parseMemo, file)
      return { index, file, semanticProfile, cacheKey: cacheHit, cached: { ...cached, semanticProfile } }
    }
  }
  const semanticProfile = await sourceProfileForPreparedFile(input, parseMemo, file)
  return { index, file, semanticProfile }
}

function sourceProfileForPreparedFile(
  input: BatchExtractionInputWithCache,
  parseMemo: ParseMemo,
  file: string,
): Promise<SemanticSourceProfileFile | undefined> {
  return withStaticExtractionTiming(input.instrumentation, 'static.semantic_profile', file, () =>
    semanticProfileForFile(file, parseMemo),
  )
}

async function parseBatchMiss(
  input: BatchExtractionInputWithCache,
  parseMemo: ParseMemo,
  providedFrontend: StaticSyntaxFrontend,
  item: PreparedBatchFile,
  recordsByFile: ReadonlyMap<string, StaticSyntaxFileRecord>,
  cacheKeyContext: StaticParseCacheKeyContext,
  cacheWriteQueue: StaticCacheWriteQueue,
  projectionCache: ReturnType<typeof createStaticRecordProjectionCache>,
): Promise<ParsedBatchMiss> {
  const cacheState = await cacheStateForParsedBatchMiss({
    root: input.root,
    file: item.file,
    compilerInputs: input.cache.compilerInputs,
    store: input.cache.store,
    parseMemo,
    recordsByFile,
    cacheKeyContext,
    instrumentation: input.instrumentation,
  })
  if (cacheState.cached) {
    return { index: item.index, result: { ...cacheState.cached, semanticProfile: item.semanticProfile } }
  }
  const parsed = await withStaticExtractionTiming(input.instrumentation, 'static.extract_file.total', item.file, () =>
    parseWithRecordMemo(
      input.root,
      item.file,
      input.runtime,
      providedFrontend,
      parseMemo,
      input.instrumentation,
      projectionCache,
      input.nativeFactProjection,
    ),
  )
  const result = Object.freeze({
    file: item.file,
    ...parsed,
    semanticProfile: item.semanticProfile,
    fromCache: false,
  })
  const cacheKey = cacheState.cacheKey
  if (cacheKey) {
    cacheWriteQueue.enqueue(() =>
      withStaticExtractionTiming(input.instrumentation, 'static.cache.write', item.file, () =>
        input.cache.store.set(cacheKey, result, cacheState.cacheMetadata),
      ),
    )
  }
  return { index: item.index, result }
}
function hasBatchExtractionCache(input: BatchExtractionInput): input is BatchExtractionInputWithCache {
  return input.cache !== undefined
}

async function parseBatchRecords(input: BatchExtractionInput, files: readonly string[], parseMemo: ParseMemo) {
  return withStaticExtractionTiming(input.instrumentation, 'static.syntax_record.batch_parse', undefined, async () =>
    input.syntaxFrontend.parseFiles(await batchSyntaxInputs(input.root, files, parseMemo)),
  )
}

async function batchSyntaxInputs(
  root: string,
  files: readonly string[],
  parseMemo: ParseMemo,
): Promise<readonly StaticSyntaxFileInput[]> {
  return Promise.all(
    files.map(async (file) => ({
      root,
      file,
      source: (await parseMemo.readSourceInfo(file)).source,
    })),
  )
}
