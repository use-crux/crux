import type { IndexDiagnostic, IndexRuleDescriptor, ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import type { IndexerExtension, IndexDependency, ExtensionRuleInput, ExtensionRuleResult } from '../../extensions'
import type { ExtensionRuntimeManifest } from '../../extensions/runtime'
import {
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
  type ProjectIndexCompilerProfile,
} from '../../compiler/profile'
import { mapBounded } from '../../pipeline'
import { parseStaticDefinitionsFromFacts } from '../file'
import { createStaticExtractionParser } from '../parser'
import { cacheKeyInput, noStaticParseCache, persistentStaticParseCache } from './cache'
import { staticExtractionIdentity, type StaticExtractionIdentity } from './identity'
import { createParseMemo, nodeSourceReader, type ParseMemo, type SourceReader } from './source-io'

export type { SourceReader } from './source-io'

export interface StaticExtractionOptions {
  readonly root: string
  readonly profile?: ProjectIndexCompilerProfile
  readonly extensions?: readonly IndexerExtension[]
  readonly sources?: SourceReader
  readonly cache?: 'persistent' | 'none' | StaticParseCacheStore
}

export interface StaticExtractionEngine {
  readonly identity: StaticExtractionIdentity
  readonly manifest: ExtensionRuntimeManifest
  extractFile(file: string): Promise<StaticFileExtraction>
  extractFiles(
    files: readonly string[],
    options?: { readonly concurrency?: number },
  ): Promise<readonly StaticFileExtraction[]>
  readonly rules: {
    readonly descriptors: readonly IndexRuleDescriptor[]
    check(input: ExtensionRuleInput): ExtensionRuleResult
  }
  explainFile(file: string): Promise<StaticExtractionExplanation>
}

export interface StaticFileExtraction {
  readonly file: string
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly dependencies: readonly string[]
  readonly fromCache: boolean
}

export interface StaticParseCacheStore {
  get(key: string): Promise<StaticFileExtraction | undefined>
  set(key: string, value: StaticFileExtraction): Promise<void>
}

export interface StaticExtractionExplanation extends StaticFileExtraction {
  readonly cacheInputs: readonly IndexDependency[]
}

export function createStaticExtraction(options: StaticExtractionOptions): StaticExtractionEngine {
  const profile = compilerProfileWithExtensions(options.profile ?? cruxCoreCompilerProfile, options.extensions ?? [])
  const runtime = createProjectIndexCompilerRuntime(profile)
  const identity = staticExtractionIdentity({ profile, extensionRuntime: runtime.extensionRuntime })
  const parser = createStaticExtractionParser(runtime.extensionRuntime, {
    intrinsicCallNames: [...identity.callNames],
  })
  const sources = options.sources ?? nodeSourceReader()
  const cacheEnabled = options.cache !== 'none'
  const cache = cacheStore(options.root, options.cache)

  const extractFile = async (file: string): Promise<StaticFileExtraction> => {
    const parseMemo = createParseMemo(sources)
    const key = cacheEnabled
      ? await cacheKeyInput({
          root: options.root,
          file,
          parseMemo,
          compilerInputs: identity.cacheInputs,
        })
      : undefined
    if (key) {
      const cached = await cache.get(JSON.stringify(key))
      if (cached) return cached
    }
    const parsed = await parseWithMemo(options.root, file, parser, parseMemo)
    const extracted = Object.freeze({ file, ...parsed, fromCache: false })
    if (key) await cache.set(JSON.stringify(key), extracted)
    return extracted
  }

  return Object.freeze({
    identity,
    manifest: runtime.extensionRuntime.manifest,
    extractFile,
    extractFiles: (files: readonly string[], extractOptions?: { readonly concurrency?: number }) =>
      mapBounded(files, extractOptions?.concurrency ?? 8, (file) => extractFile(file)),
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

async function parseWithMemo(
  root: string,
  file: string,
  parser: Parameters<typeof parseStaticDefinitionsFromFacts>[2],
  parseMemo: ParseMemo,
): Promise<Omit<StaticFileExtraction, 'file' | 'fromCache'>> {
  return parseStaticDefinitionsFromFacts(root, file, parser, parseMemo)
}

function compilerProfileWithExtensions(
  profile: ProjectIndexCompilerProfile,
  extensions: readonly IndexerExtension[],
): ProjectIndexCompilerProfile {
  if (extensions.length === 0) return profile
  return {
    ...profile,
    extensions: [...profile.extensions, ...extensions],
  }
}

function cacheStore(root: string, cache: StaticExtractionOptions['cache']): StaticParseCacheStore {
  if (cache === 'none') return noStaticParseCache()
  if (!cache || cache === 'persistent') return persistentStaticParseCache(root)
  return cache
}
