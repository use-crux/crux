import { resolve } from 'node:path'
import type {
  IndexRuleDescriptor,
  ProjectIndexShard,
  ProjectIndexSnapshot,
  ProjectModelResolutionMode,
} from '@use-crux/core/project-index'
import { loadConfigPolicyProjectConfig, loadProjectConfig } from '../../config'
import {
  compilerProfileWithResolvedExtensions,
  createStaticExtensionHostRuntime,
  cruxCoreCompilerProfile,
  type StaticExtensionHostRuntime,
} from '../../compiler/profile'
import { loadIndexerExtensionReferences } from '../../extensions'
import type {
  IndexDependency,
  RelationSpec,
  ResolvedIndexerExtension,
  StaticEvidenceInterestManifest,
  StaticExtensionHostManifest,
} from '../../extensions'
import type { StaticCandidateClassification } from '../../candidates'
import { staticDefinitionFileSelection } from '../../files'
import {
  staticExtractionCallInterests,
  staticExtractionCallNames,
  staticExtractionConstructorInterests,
  staticExtractionNativeFactPruneCallNames,
} from '../../static/extraction/setup'
import { staticParseCacheManifestStatus } from '../../static/extraction/cache'
import { staticExtensionPackageCacheInputs, staticExtractionIdentity } from '../../static/extraction/identity'
import type { StaticParseCacheHit } from '../../static/extraction/types'
import { staticIndexSyntaxSelectionFromConfig } from '../config'
import { staticSyntaxPlanFileSelection } from './files'
import { builtInIndexRuleDescriptors } from '../../lints/rules'
import { discoverProjectShards } from '../../shards/discovery'
import {
  type StaticSyntaxCallInterest,
  type StaticSyntaxConstructorInterest,
  type StaticSyntaxFrontendIdentity,
} from '../syntax'
import { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from '../syntax/frontends/oxc'

const DEFAULT_CONSTRUCTOR_NAMES = ['Agent'] as const

/** Options for inspecting the static syntax plan used by Static Index parser hosts. */
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
   * Include static cache hit/miss metadata for Static Index parser hosts.
   *
   * This can avoid Rust/Oxc parsing for files whose static extraction
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
  /** Whether the project config loaded successfully and declared a Runtime Engine. */
  readonly runtimeConfigured?: boolean
  /** Absolute primary and support source files that may be needed by the syntax frontend. */
  readonly files: readonly string[]
  /**
   * Subset of `files` that the Static Index host must parse.
   *
   * When cache status is requested, this includes primary extraction cache
   * misses plus local import records needed as cross-file lookup evidence.
   * Omitted when cache status was not requested.
   */
  readonly filesToParse?: readonly string[]
  /** Primary files with a valid static extraction cache hit for the native syntax frontend. */
  readonly cacheHits?: readonly string[]
  /** Primary files that need static syntax records because no exact static cache entry exists. */
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
  /** Static Index-covered call names whose heavy match evidence can be pruned after packet projection. */
  readonly pruneNativeFactCallNames: readonly string[]
  /** Syntax frontend identity expected from the Static Index parser host. */
  readonly syntaxFrontend: StaticSyntaxFrontendIdentity
  /** Whether project config opted into the experimental Static Index syntax path. */
  readonly staticSyntaxEnabled: boolean
  /** Backend-neutral evidence interests requested by extensions. */
  readonly staticInterests: StaticEvidenceInterestManifest
  /** Data-only relation policies used by Static Index finalization. */
  readonly relationSpecs: readonly RelationSpec[]
  /** Data-only rule descriptors used by Static Index finalization and devtools catalogs. */
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  /** Compiler-owned source graph metadata used by Static Index source-row finalization. */
  readonly sourceGraph: ProjectIndexSnapshot['sourceGraph']
  /** TypeScript extension-host requirements after Static Index coverage is applied. */
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
  const resolutionMode = options.resolutionMode ?? 'source-only'
  const loaded = await loadProjectConfig(root, options.configPath, resolutionMode)
  const shardGraph = discoverProjectShards(root)
  const staticSyntaxSelection = await staticIndexSyntaxSelectionForPlan(
    root,
    options.configPath,
    loaded.loaded.experimental,
    resolutionMode,
  )
  const runtimeResult = await staticExtensionHostRuntimeForPlan(root, loaded.loaded.indexer)
  const runtime = runtimeResult.runtime
  const callNames = [...staticExtractionCallNames(runtime.profile, runtime.extensionRuntime)].sort()
  const staticSelection = staticDefinitionFileSelection(root, {
    additionalCallNames: runtime.extensionRuntime.manifest.callNames,
  })
  const primaryFiles = staticSyntaxPlanPrimaryFiles(staticSelection.files, loaded.loaded.configFile)
  const fileSelection = await staticSyntaxPlanFileSelection({ root, primaryFiles })
  const files = fileSelection.files
  const cacheStatus = options.includeCacheStatus
    ? await staticIndexSyntaxCacheStatus({
        root,
        files: fileSelection.primaryFiles,
        runtime,
        additionalCacheInputs: runtimeResult.cacheInputs,
      })
    : undefined
  const filesToParse = cacheStatus
    ? [...new Set([...cacheStatus.cacheMisses, ...fileSelection.recordSupportFiles])].sort()
    : undefined
  return {
    root,
    ...(options.projectName ? { projectName: options.projectName } : {}),
    ...(loaded.loaded.configFile ? { configFile: loaded.loaded.configFile } : {}),
    ...(loaded.loaded.importFailed ? {} : { runtimeConfigured: Boolean(loaded.loaded.crux?.config.runtime) }),
    files,
    ...(cacheStatus
      ? {
          filesToParse,
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
    syntaxFrontend: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    staticSyntaxEnabled: staticSyntaxSelection.enabled,
    staticInterests: runtime.extensionRuntime.manifest.staticInterests,
    relationSpecs: runtime.extensionRuntime.manifest.relationSpecs,
    ruleDescriptors: [...builtInIndexRuleDescriptors(), ...runtime.extensionRuntime.ruleDescriptors],
    sourceGraph: projectStaticSyntaxPlanSourceGraph(shardGraph.shards),
    staticHost: runtime.extensionRuntime.manifest.staticHost,
  }
}

function projectStaticSyntaxPlanSourceGraph(shards: readonly ProjectIndexShard[]): ProjectIndexSnapshot['sourceGraph'] {
  return {
    schemaVersion: 1,
    producedBy: '@use-crux/indexer',
    capabilities: [
      'source-dependencies',
      'source-dependents',
      'definition-ownership',
      'diagnostic-ownership',
      'project-shards',
    ],
    shards: [...(shards ?? [])],
  }
}

async function staticIndexSyntaxSelectionForPlan(
  root: string,
  configPath: string | undefined,
  loadedExperimental: Awaited<ReturnType<typeof loadProjectConfig>>['loaded']['experimental'],
  resolutionMode: ProjectModelResolutionMode,
) {
  const loadedSelection = staticIndexSyntaxSelectionFromConfig(loadedExperimental)
  if (loadedSelection.enabled) return loadedSelection
  if (resolutionMode === 'source-only') return loadedSelection
  const result = await loadConfigPolicyProjectConfig(root, configPath)
  return staticIndexSyntaxSelectionFromConfig(result.loaded.experimental)
}

async function staticIndexSyntaxCacheStatus(input: {
  readonly root: string
  readonly files: readonly string[]
  readonly runtime: StaticExtensionHostRuntime
  readonly additionalCacheInputs: readonly IndexDependency[]
}): Promise<{
  readonly cacheHits: readonly string[]
  readonly cacheMisses: readonly string[]
  readonly cacheEntries: readonly StaticParseCacheHit[]
}> {
  const identity = staticExtractionIdentity({
    profile: input.runtime.profile,
    extensionRuntime: input.runtime.extensionRuntime,
    syntaxFrontend: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    additionalCacheInputs: input.additionalCacheInputs,
  })
  return staticParseCacheManifestStatus({
    root: input.root,
    files: input.files,
    compilerInputs: identity.cacheInputs,
  })
}

async function staticExtensionHostRuntimeForPlan(
  root: string,
  indexerConfig: Awaited<ReturnType<typeof loadProjectConfig>>['loaded']['indexer'],
): Promise<{
  readonly runtime: StaticExtensionHostRuntime
  readonly cacheInputs: readonly IndexDependency[]
}> {
  const baseRuntime = createStaticExtensionHostRuntime(cruxCoreCompilerProfile)
  const configuredExtensions = indexerConfig?.extensions ?? []
  if (configuredExtensions.length === 0) return { runtime: baseRuntime, cacheInputs: [] }

  const loaded = await loadIndexerExtensionReferences({
    root,
    config: indexerConfig,
  })
  if (loaded.extensions.length === 0) return { runtime: baseRuntime, cacheInputs: [] }
  return {
    runtime: createStaticExtensionHostRuntime(
      compilerProfileWithResolvedExtensions(baseRuntime.profile, loaded.extensions),
    ),
    cacheInputs: extensionPackageCacheInputs(loaded.extensions),
  }
}

function extensionPackageCacheInputs(
  extensions: readonly ResolvedIndexerExtension[],
): readonly IndexDependency[] {
  return staticExtensionPackageCacheInputs(
    extensions.map((extension) => ({
      packageName: extension.reference.package,
      exportName: extension.reference.export,
      packageVersion: extension.packageVersion,
    })),
  )
}

function staticSyntaxPlanPrimaryFiles(files: readonly string[], configFile: string | undefined): readonly string[] {
  if (!configFile) return files
  return [...new Set([...files, configFile])].sort()
}

function constructorNamesFromRuntime(runtime: StaticExtensionHostRuntime): readonly string[] {
  return [
    ...new Set([
      ...DEFAULT_CONSTRUCTOR_NAMES,
      ...(runtime.extensionRuntime.manifest.staticInterests.constructors ?? []).map((interest) => interest.name),
    ]),
  ].sort()
}
