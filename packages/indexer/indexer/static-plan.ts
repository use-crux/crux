import { resolve } from 'node:path'
import type { ProjectModelResolutionMode } from '@crux/core/project-index'
import { loadConfigPolicyProjectConfig, loadProjectConfig } from './config'
import {
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
  type ProjectIndexCompilerRuntime,
} from './compiler/profile'
import { loadIndexerExtensionReferences } from './extensions'
import type { StaticEvidenceInterestManifest, StaticExtensionHostManifest } from './extensions'
import type { StaticCandidateClassification } from './candidates'
import { staticDefinitionFileSelection } from './files'
import {
  staticExtractionCallInterests,
  staticExtractionCallNames,
  staticExtractionConstructorInterests,
  staticExtractionNativeFactPruneCallNames,
} from './static/extraction/setup'
import { staticParseCacheManifestStatus } from './static/extraction/cache'
import { staticExtractionIdentity } from './static/extraction/identity'
import type { StaticParseCacheHit } from './static/extraction/types'
import { nativeStaticAstSelectionFromConfig } from './native-static-config'
import {
  RUST_OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
  type StaticSyntaxCallInterest,
  type StaticSyntaxConstructorInterest,
  type StaticSyntaxFrontendIdentity,
} from './static/syntax-record'

const DEFAULT_CONSTRUCTOR_NAMES = ['Agent'] as const

/** Options for inspecting the static syntax plan used by native parser hosts. */
export interface InspectProjectStaticSyntaxPlanOptions {
  /** Project root used for source discovery and config lookup. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Optional project name supplied by an embedding CLI or server. */
  readonly projectName?: string
  /**
   * Config loading mode for extension-aware planning.
   *
   * Defaults to `source-only` so the plan matches the default AST index path
   * and does not import authored project modules.
   */
  readonly resolutionMode?: ProjectModelResolutionMode
  /**
   * Include static cache hit/miss metadata for native parser hosts.
   *
   * This can avoid native parsing for files whose Rust/Oxc static extraction
   * output is already cached. Status is read from the persistent cache manifest
   * and validated against source, dependency, config, and cache-entry hashes.
   */
  readonly includeCacheStatus?: boolean
}

/** Static syntax plan consumed by Go before invoking the Rust/Oxc parser. */
export interface ProjectStaticSyntaxPlan {
  /** Absolute project root used by the compiler. */
  readonly root: string
  /** Project name supplied by the host, if any. */
  readonly projectName?: string
  /** Config file selected while planning, if one was discovered. */
  readonly configFile?: string
  /** Absolute source files the compiler will ask the syntax frontend to parse. */
  readonly files: readonly string[]
  /** Subset of `files` that the native host must parse. Omitted when cache status was not requested. */
  readonly filesToParse?: readonly string[]
  /** Files with a valid static extraction cache hit for the native syntax frontend. */
  readonly cacheHits?: readonly string[]
  /** Files that need native syntax records because no exact static cache entry exists. */
  readonly cacheMisses?: readonly string[]
  /** Validated cache entries that Node projection may consume without recomputing exact keys. */
  readonly cacheEntries?: readonly StaticParseCacheHit[]
  /** Candidate files skipped by the same static selection policy as AST indexing. */
  readonly skipped: readonly StaticCandidateClassification[]
  /** Call-expression names worth recording in syntax records. */
  readonly callNames: readonly string[]
  /** Import-aware call-expression interests worth recording in syntax records. */
  readonly callInterests: readonly StaticSyntaxCallInterest[]
  /** Constructor names worth recording in syntax records. */
  readonly constructorNames: readonly string[]
  /** Import-aware constructor interests worth recording in syntax records. */
  readonly constructorInterests: readonly StaticSyntaxConstructorInterest[]
  /** Native-covered call names whose heavy match evidence can be pruned after packet projection. */
  readonly pruneNativeFactCallNames: readonly string[]
  /** Syntax frontend identity expected from the native parser host. */
  readonly syntaxFrontend: StaticSyntaxFrontendIdentity
  /** Whether project config opted into the experimental native static AST path. */
  readonly nativeAstEnabled: boolean
  /** Backend-neutral evidence interests requested by extensions. */
  readonly staticInterests: StaticEvidenceInterestManifest
  /** TypeScript extension-host requirements after native static coverage is applied. */
  readonly staticHost: StaticExtensionHostManifest
}

/**
 * Resolves the static syntax plan for a Project Index run.
 *
 * Go uses this as a planning artifact: Node owns config/extension policy and
 * file selection, while Go owns Rust worker orchestration and returns syntax
 * records to Node for projection.
 */
export async function inspectProjectStaticSyntaxPlan(
  options: InspectProjectStaticSyntaxPlanOptions,
): Promise<ProjectStaticSyntaxPlan> {
  const root = resolve(options.root)
  const loaded = await loadProjectConfig(root, options.configPath, options.resolutionMode ?? 'source-only')
  const nativeAstSelection = await nativeAstSelectionForPlan(root, options.configPath, loaded.loaded.experimental)
  const runtime = await projectIndexCompilerRuntimeForPlan(root, loaded.loaded.indexer)
  const callNames = [...staticExtractionCallNames(runtime.profile, runtime.extensionRuntime)].sort()
  const staticSelection = staticDefinitionFileSelection(root, {
    additionalCallNames: runtime.extensionRuntime.manifest.callNames,
  })
  const files = staticSyntaxPlanFiles(staticSelection.files, loaded.loaded.configFile)
  const cacheStatus = options.includeCacheStatus
    ? await nativeStaticSyntaxCacheStatus({ root, files, runtime })
    : undefined
  return {
    root,
    ...(options.projectName ? { projectName: options.projectName } : {}),
    ...(loaded.loaded.configFile ? { configFile: loaded.loaded.configFile } : {}),
    files,
    ...(cacheStatus
      ? {
          filesToParse: cacheStatus.cacheMisses,
          cacheHits: cacheStatus.cacheHits,
          cacheMisses: cacheStatus.cacheMisses,
          cacheEntries: cacheStatus.cacheEntries,
        }
      : {}),
    skipped: staticSelection.skipped,
    callNames,
    callInterests: [...staticExtractionCallInterests(runtime.profile, runtime.extensionRuntime)],
    constructorNames: constructorNamesFromRuntime(runtime),
    constructorInterests: [...staticExtractionConstructorInterests(runtime.extensionRuntime)],
    pruneNativeFactCallNames: [...staticExtractionNativeFactPruneCallNames(runtime.extensionRuntime)].sort(),
    syntaxFrontend: RUST_OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    nativeAstEnabled: nativeAstSelection.enabled,
    staticInterests: runtime.extensionRuntime.manifest.staticInterests,
    staticHost: runtime.extensionRuntime.manifest.staticHost,
  }
}

async function nativeAstSelectionForPlan(
  root: string,
  configPath: string | undefined,
  loadedExperimental: Awaited<ReturnType<typeof loadProjectConfig>>['loaded']['experimental'],
) {
  const loadedSelection = nativeStaticAstSelectionFromConfig(loadedExperimental)
  if (loadedSelection.enabled) return loadedSelection
  const result = await loadConfigPolicyProjectConfig(root, configPath)
  return nativeStaticAstSelectionFromConfig(result.loaded.experimental)
}

async function nativeStaticSyntaxCacheStatus(input: {
  readonly root: string
  readonly files: readonly string[]
  readonly runtime: ProjectIndexCompilerRuntime
}): Promise<{
  readonly cacheHits: readonly string[]
  readonly cacheMisses: readonly string[]
  readonly cacheEntries: readonly StaticParseCacheHit[]
}> {
  const identity = staticExtractionIdentity({
    profile: input.runtime.profile,
    extensionRuntime: input.runtime.extensionRuntime,
    syntaxFrontend: RUST_OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
  })
  return staticParseCacheManifestStatus({
    root: input.root,
    files: input.files,
    compilerInputs: identity.cacheInputs,
  })
}

async function projectIndexCompilerRuntimeForPlan(
  root: string,
  indexerConfig: Awaited<ReturnType<typeof loadProjectConfig>>['loaded']['indexer'],
): Promise<ProjectIndexCompilerRuntime> {
  const baseRuntime = createProjectIndexCompilerRuntime(cruxCoreCompilerProfile)
  const configuredExtensions = indexerConfig?.extensions ?? []
  if (configuredExtensions.length === 0) return baseRuntime

  const loaded = await loadIndexerExtensionReferences({
    root,
    config: indexerConfig,
  })
  if (loaded.extensions.length === 0) return baseRuntime
  return createProjectIndexCompilerRuntime({
    ...baseRuntime.profile,
    extensions: [...baseRuntime.profile.extensions, ...loaded.extensions.map((entry) => entry.extension)],
  })
}

function staticSyntaxPlanFiles(files: readonly string[], configFile: string | undefined): readonly string[] {
  if (!configFile) return files
  return [...new Set([...files, configFile])].sort()
}

function constructorNamesFromRuntime(runtime: ProjectIndexCompilerRuntime): readonly string[] {
  return [
    ...new Set([
      ...DEFAULT_CONSTRUCTOR_NAMES,
      ...(runtime.extensionRuntime.manifest.staticInterests.constructors ?? []).map((interest) => interest.name),
    ]),
  ].sort()
}
