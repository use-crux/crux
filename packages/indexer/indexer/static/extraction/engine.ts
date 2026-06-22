import { createProjectIndexCompilerRuntime, cruxCoreCompilerProfile } from '../../compiler/profile'
import { mapBounded } from '../../pipeline'
import { withStaticExtractionTiming, type StaticExtractionInstrumentation } from '../instrumentation'
import {
  createTypeScriptStaticSyntaxFrontend,
  type StaticSyntaxFrontend,
  type StaticSyntaxFrontendFactory,
} from '../syntax-record'
import { extractFilesWithBatchFrontend, parseWithRecordMemo, semanticProfileForFile } from './batch'
import { cacheKeyInput, createStaticParseCacheKeyContext, noStaticParseCache, persistentStaticParseCache } from './cache'
import { staticExtractionIdentity } from './identity'
import {
  compilerProfileWithExtensions,
  staticExtractionCallInterests,
  staticExtractionCallNames,
  staticExtractionConstructorInterests,
  staticExtractionNativeFactPruneCallNames,
} from './setup'
import { createParseMemo, nodeSourceReader, type SourceReader } from './source-io'
import type {
  StaticExtractionEngine,
  StaticExtractionOptions,
  StaticFileExtraction,
  StaticParseCacheHit,
  StaticParseCacheStore,
} from './types'

export type { SourceReader } from './source-io'
export type {
  StaticExtractionEngine,
  StaticExtractionExplanation,
  StaticExtractionOptions,
  StaticFileExtraction,
  StaticParseCacheHit,
  StaticParseCacheStore,
} from './types'
export type {
  StaticExtractionInstrumentation,
  StaticExtractionTiming,
  StaticExtractionTimingName,
} from '../instrumentation'

/**
 * Creates the static extraction engine for a project root.
 *
 * The returned object is frozen and has no registration side effects. Extension manifests are
 * normalized at construction time; invalid manifests fail fast before any source file is read.
 */
export function createStaticExtraction(options: StaticExtractionOptions): StaticExtractionEngine {
  const profile = compilerProfileWithExtensions(options.profile ?? cruxCoreCompilerProfile, options.extensions ?? [])
  const runtime = createProjectIndexCompilerRuntime(profile)
  const callNames = staticExtractionCallNames(profile, runtime.extensionRuntime)
  const syntaxFrontend = resolveSyntaxFrontend(options.syntaxFrontend, {
    callNames: [...callNames],
    callInterests: [...staticExtractionCallInterests(profile, runtime.extensionRuntime)],
    constructorInterests: [...staticExtractionConstructorInterests(runtime.extensionRuntime)],
    pruneNativeFactCallNames: [...staticExtractionNativeFactPruneCallNames(runtime.extensionRuntime)],
  })
  const identity = staticExtractionIdentity({
    profile,
    extensionRuntime: runtime.extensionRuntime,
    syntaxFrontend: syntaxFrontend.identity,
    nativeFactProjection: options.nativeFactProjection,
  })
  const sources = options.sources ?? nodeSourceReader()
  const cacheEnabled = options.cache !== 'none'
  const cache = cacheStore(options.root, options.cache)
  const cacheKeyContext = createStaticParseCacheKeyContext(options.root)
  const cacheHitsByFile = new Map((options.cacheHits ?? []).map((hit) => [hit.file, hit.cacheKey] as const))
  const instrumentation = options.instrumentation

  const extractFile = async (file: string): Promise<StaticFileExtraction> => {
    return withStaticExtractionTiming(instrumentation, 'static.extract_file.total', file, async () => {
      const parseMemo = createParseMemo(sources)
      const cacheHit = cacheEnabled ? cacheHitsByFile.get(file) : undefined
      if (cacheHit) {
        const cached = await withStaticExtractionTiming(instrumentation, 'static.cache.read', file, () =>
          cache.get(cacheHit),
        )
        if (cached?.semanticProfile) return cached
        if (cached) return { ...cached, semanticProfile: await semanticProfileForExtractedFile(instrumentation, file, parseMemo) }
      }
      const key = cacheEnabled
        ? await withStaticExtractionTiming(instrumentation, 'static.cache.key', file, () =>
            cacheKeyInput({
              root: options.root,
              file,
              parseMemo,
              compilerInputs: identity.cacheInputs,
              context: cacheKeyContext,
            }),
          )
        : undefined
      if (key) {
        const cached = await withStaticExtractionTiming(instrumentation, 'static.cache.read', file, () =>
          cache.get(JSON.stringify(key)),
        )
        if (cached?.semanticProfile) return cached
        if (cached) return { ...cached, semanticProfile: await semanticProfileForExtractedFile(instrumentation, file, parseMemo) }
      }
      const semanticProfile = await semanticProfileForExtractedFile(instrumentation, file, parseMemo)
      const parsed = await parseWithRecordMemo(
        options.root,
        file,
        runtime.extensionRuntime,
        syntaxFrontend,
        parseMemo,
        instrumentation,
        undefined,
        options.nativeFactProjection,
      )
      const extracted = Object.freeze({ file, ...parsed, semanticProfile, fromCache: false })
      if (key) {
        await withStaticExtractionTiming(instrumentation, 'static.cache.write', file, () =>
          cache.set(JSON.stringify(key), extracted, key),
        )
      }
      return extracted
    })
  }

  const extractFiles = (files: readonly string[], extractOptions?: { readonly concurrency?: number }) => {
    const parseFiles = syntaxFrontend.parseFiles
    const concurrency = extractOptions?.concurrency ?? 8
    if (parseFiles && files.length > 1) {
      return extractFilesWithBatchFrontend({
        root: options.root,
        files,
        runtime: runtime.extensionRuntime,
        syntaxFrontend: { ...syntaxFrontend, parseFiles },
        sources,
        concurrency,
        instrumentation,
        nativeFactProjection: options.nativeFactProjection,
        cache: cacheEnabled
          ? {
              store: cache,
              compilerInputs: identity.cacheInputs,
              hitsByFile: cacheHitsByFile,
            }
          : undefined,
      })
    }
    return mapBounded(files, concurrency, (file) => extractFile(file))
  }

  return Object.freeze({
    identity,
    manifest: runtime.extensionRuntime.manifest,
    extractFile,
    extractFiles,
    rules: Object.freeze({
      descriptors: runtime.extensionRuntime.ruleDescriptors,
      check: runtime.extensionRuntime.checkRules,
    }),
    explainFile: async (file: string) => ({
      ...(await extractFile(file)),
      cacheInputs: identity.cacheInputs,
    }),
  })
}

function semanticProfileForExtractedFile(
  instrumentation: StaticExtractionInstrumentation | undefined,
  file: string,
  parseMemo: ReturnType<typeof createParseMemo>,
): Promise<StaticFileExtraction['semanticProfile']> {
  return withStaticExtractionTiming(instrumentation, 'static.semantic_profile', file, () =>
    semanticProfileForFile(file, parseMemo),
  )
}

function resolveSyntaxFrontend(
  input: StaticExtractionOptions['syntaxFrontend'],
  frontendOptions: Parameters<StaticSyntaxFrontendFactory>[0],
): StaticSyntaxFrontend {
  if (!input) return createTypeScriptStaticSyntaxFrontend(frontendOptions)
  return typeof input === 'function' ? input(frontendOptions) : input
}

/**
 * Resolves the cache option into a store implementation for this engine instance.
 *
 * The engine still decides whether a lookup should occur. The store only answers reads and writes for
 * keys that already include source hashes, profile identity, extension identity, and syntax frontend
 * identity.
 */
function cacheStore(root: string, cache: StaticExtractionOptions['cache']): StaticParseCacheStore {
  if (cache === 'none') return noStaticParseCache()
  if (!cache || cache === 'persistent') return persistentStaticParseCache(root)
  return cache
}
