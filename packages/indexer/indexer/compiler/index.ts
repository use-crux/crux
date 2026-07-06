import { resolve } from 'node:path'
import type {
  ContextMeta,
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  IndexSourceFile,
  CruxLintConfig,
  ProjectIndexSnapshot,
  ProjectIndexShard,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  PromptMeta,
  ToolMeta,
} from '@use-crux/core/project-index'
import type { ProjectModelResolutionMode } from '@use-crux/core/project-index'
import { indexDefinitionsFromSnapshot, serializeIndex } from '@use-crux/core/project-index/serializers'
import { applyIndexLintConfig } from '../lints/config'
import { indexLintFindings } from '../lints/findings'
import { applyIndexLintSuppressions } from '../lints/suppressions'
import { builtInIndexRuleDescriptors, validateBuiltInIndexRuleManifests } from '../lints/rules'
import { loadProjectConfig, type LoadedProjectConfig } from '../config'
import { discoverProjectDefinitions, type ProjectDiscoveryResult } from '../discovery'
import { sourceTooLargeDiagnostic } from '../diagnostics'
import {
  loadIndexerExtensionReferences,
  type IndexDependency,
  type IndexerExtensionRuntime as ExtensionRuntime,
  type ResolvedIndexerExtension,
} from '../extensions'
import { staticDefinitionFileSelection, type StaticDefinitionFileSelection } from '../files'
import { createIndexGraphBuilder, graphSources } from '../graph/builder'
import { dedupeById, mergeDefinitionsById } from '../merge'
import { type IndexPatch, type IndexPatchFacts, type IndexPatchStatus } from '../patches'
import { backfillDefinitionPaths } from '../paths'
import { relationDiagnosticsFromReport, resolveRelationModel } from '../relations'
import { backfillDefinitionSources, mergeSources } from '../sources'
import { discoverProjectShards, shardIdForSourceFile, staticFileBatchesForShards } from '../shards/discovery'
import { compareCodepoint } from '../sort'
import type { ProjectShardFileBatch } from '../shards/types'
import {
  createStaticExtraction,
  type StaticExtractionEngine,
  type StaticExtractionInstrumentation,
  type StaticParseCacheHit,
} from '../static/extraction/engine'
import { staticExtensionPackageCacheInputs } from '../static/extraction/identity'
import type {
  NativeFactProjectionMode,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendFactory,
} from '../static-index/syntax'
import type { SemanticSourceProfile, SemanticSourceProfileFile } from '../semantic/source-profile'
import type { SourceGraph } from '../types'
import { suppressRichImportDiagnosticsForStaticDefinitions } from './diagnostics'
import {
  compilerProfileWithResolvedExtensions,
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
  type ProjectIndexCompilerRuntime,
  type ProjectIndexCompilerProfile,
} from './profile'
import { DEFAULT_PROJECT_MODEL_RESOLUTION_MODE } from '../resolution-mode'

export type ProjectIndexCompileMode = ProjectModelResolutionMode

export interface ProjectIndexCompilerInput {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  readonly mode?: ProjectIndexCompileMode
  readonly indexedAt?: string
  /**
   * Internal syntax frontend override for compiler-owned static extraction.
   *
   * Embedders use this to project syntax records produced by another process
   * through the normal compiler, extension, lint, graph, and patch pipeline.
   * This is not a stable project configuration switch.
   *
   * @internal
   */
  readonly staticSyntaxFrontend?: StaticSyntaxFrontend | StaticSyntaxFrontendFactory
  /**
   * Internal native syntax-record fact lane emitted by static extraction.
   *
   * This is not a project configuration switch. Hosts use it to separate
   * native packet output from TypeScript extractor output while preserving the
   * combined relation-binding contract at the compiler boundary.
   *
   * @internal
   */
  readonly nativeFactProjection?: NativeFactProjectionMode
  /**
   * Optional timing hook for compiler-owned static extraction benchmarks and
   * worker diagnostics.
   *
   * @internal
   */
  readonly staticInstrumentation?: StaticExtractionInstrumentation
  /**
   * Internal validated static cache hits supplied by a native parser host.
   *
   * @internal
   */
  readonly staticCacheHits?: readonly StaticParseCacheHit[]
}

export interface ProjectIndexCompilerResult {
  readonly project: ProjectIdentity
  readonly indexedAt: string
  readonly lint?: CruxLintConfig
  readonly facts: IndexPatchFacts
  readonly sources: readonly IndexSourceFile[]
  readonly graphEvidence: SourceGraph
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly lintFindings: readonly IndexLintFinding[]
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
  readonly sourceGraph?: ProjectIndexSnapshot['sourceGraph']
  readonly semanticSourceProfile?: SemanticSourceProfile
}

export interface ProjectIndexCompiler {
  readonly profile: ProjectIndexCompilerProfile
  readonly extensionRuntime: ExtensionRuntime
  readonly compile: (input: ProjectIndexCompilerInput) => Promise<ProjectIndexCompilerResult>
}

interface CompilerSnapshotInput {
  readonly root: string
  readonly project: ProjectIdentity
  readonly indexedAt: string
  readonly initialFacts: ProjectIndexInitialFacts
  readonly initialDiagnostics: readonly IndexDiagnostic[]
  readonly initialSources: readonly IndexSourceFile[]
  readonly discovered: ProjectDiscoveryResult
  readonly loaded: LoadedProjectConfig
  readonly staticFiles: readonly string[]
  readonly staticFileBatches?: readonly ProjectShardFileBatch[]
  readonly extensionRuntime: ExtensionRuntime
  readonly shards: readonly ProjectIndexShard[]
}

interface LoadedCompilerInputs {
  readonly root: string
  readonly indexedAt: string
  readonly loaded: LoadedProjectConfig
  readonly staticSelection: StaticDefinitionFileSelection
  readonly initial: {
    readonly project: ProjectIdentity
    readonly facts: ProjectIndexInitialFacts
    readonly diagnostics: readonly IndexDiagnostic[]
    readonly sources: readonly IndexSourceFile[]
  }
}

interface MergedCompilerFacts {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly IndexDiagnostic[]
}

interface ProjectIndexInitialFacts {
  readonly prompts: readonly PromptMeta[]
  readonly contexts: readonly ContextMeta[]
  readonly tools?: readonly ToolMeta[]
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

export async function compileProjectIndex(input: ProjectIndexCompilerInput): Promise<ProjectIndexCompilerResult> {
  return createProjectIndexCompiler().compile(input)
}

export function createProjectIndexCompiler(
  input: {
    readonly profile?: ProjectIndexCompilerProfile
  } = {},
): ProjectIndexCompiler {
  const builtInRuleManifestErrors = validateBuiltInIndexRuleManifests()
  if (builtInRuleManifestErrors.length > 0) {
    throw new Error(`Invalid built-in Project Index rule manifests:\n${builtInRuleManifestErrors.join('\n')}`)
  }
  const runtime = createProjectIndexCompilerRuntime(input.profile ?? cruxCoreCompilerProfile)
  return {
    profile: runtime.profile,
    extensionRuntime: runtime.extensionRuntime,
    compile: (compilerInput) =>
      compileProjectIndexWithRuntime({
        input: compilerInput,
        baseRuntime: runtime,
      }),
  }
}

async function compileProjectIndexWithRuntime(input: {
  readonly input: ProjectIndexCompilerInput
  readonly baseRuntime: ProjectIndexCompilerRuntime
}): Promise<ProjectIndexCompilerResult> {
  const loadedInputs = await loadCompilerInputs(input.input)
  const shardGraph = discoverProjectShards(loadedInputs.root)
  const runtimeResult = await compilerRuntimeForLoadedInputs({
    root: loadedInputs.root,
    baseRuntime: input.baseRuntime,
    loaded: loadedInputs.loaded,
  })
  const loadedInputsWithRuntimeSelection = withRuntimeStaticSelection({
    loadedInputs,
    runtime: runtimeResult.runtime,
  })
  const extraction = createStaticExtraction({
    root: loadedInputs.root,
    profile: runtimeResult.runtime.profile,
    syntaxFrontend: input.input.staticSyntaxFrontend,
    additionalCacheInputs: runtimeResult.cacheInputs,
    instrumentation: input.input.staticInstrumentation,
    cacheHits: input.input.staticCacheHits,
    nativeFactProjection: input.input.nativeFactProjection,
  })
  const loadedInputsWithExtensionDiagnostics = appendInitialDiagnostics(
    loadedInputsWithRuntimeSelection,
    runtimeResult.diagnostics,
  )
  const staticFileBatches = staticFileBatchesForShards(
    loadedInputsWithExtensionDiagnostics.staticSelection.files,
    shardGraph.shards,
  )
  const discovered = await discoverCompilerFacts({
    loadedInputs: loadedInputsWithExtensionDiagnostics,
    extraction,
    staticFileBatches,
  })

  return compilerResultFromDiscovery({
    root: loadedInputsWithExtensionDiagnostics.root,
    project: loadedInputsWithExtensionDiagnostics.initial.project,
    indexedAt: loadedInputsWithExtensionDiagnostics.indexedAt,
    initialFacts: loadedInputsWithExtensionDiagnostics.initial.facts,
    initialDiagnostics: loadedInputsWithExtensionDiagnostics.initial.diagnostics,
    initialSources: loadedInputsWithExtensionDiagnostics.initial.sources,
    discovered,
    loaded: loadedInputsWithExtensionDiagnostics.loaded,
    staticFiles: loadedInputsWithExtensionDiagnostics.staticSelection.files,
    staticFileBatches,
    extensionRuntime: runtimeResult.runtime.extensionRuntime,
    shards: shardGraph.shards,
  })
}

export function projectIndexSnapshotFromCompilerResult(result: ProjectIndexCompilerResult): ProjectIndexSnapshot {
  return {
    schemaVersion: 1,
    project: result.project,
    indexedAt: result.indexedAt,
    lint: result.lint,
    prompts: [...(result.facts.prompts ?? [])],
    contexts: [...(result.facts.contexts ?? [])],
    tools: result.facts.tools ? [...result.facts.tools] : undefined,
    definitions: [...(result.facts.definitions ?? [])],
    relations: [...(result.facts.relations ?? [])],
    diagnostics: [...result.diagnostics],
    lintFindings: [...result.lintFindings],
    ruleDescriptors: [...result.ruleDescriptors],
    sources: [...result.sources],
    sourceGraph: result.sourceGraph,
  }
}

export function astIndexPatchFromCompilerResult(
  result: ProjectIndexCompilerResult,
  input: {
    readonly status?: IndexPatchStatus
    readonly invalidates?: IndexPatch['invalidates']
    readonly finishedAt?: string
  } = {},
): IndexPatch {
  return {
    schemaVersion: 1,
    phase: 'ast',
    project: result.project,
    startedAt: result.indexedAt,
    finishedAt: input.finishedAt ?? result.indexedAt,
    status: input.status ?? 'ok',
    semanticSourceProfile: result.semanticSourceProfile,
    invalidates: input.invalidates ?? { all: true },
    facts: {
      prompts: result.facts.prompts,
      contexts: result.facts.contexts,
      tools: result.facts.tools,
      lint: result.facts.lint,
      definitions: result.facts.definitions,
      relations: result.facts.relations,
      diagnostics: result.diagnostics,
      lintFindings: result.lintFindings,
      ruleDescriptors: result.ruleDescriptors,
      sources: result.sources,
      sourceGraph: result.sourceGraph,
    },
  }
}

/**
 * Project runtime-rich compiler output as an isolated runtime phase patch.
 *
 * Runtime patches are applied after source/config/semantic facts and never
 * invalidate the base AST index by default. The caller must request any
 * invalidation explicitly, keeping authored module execution opt-in.
 */
export function runtimeIndexPatchFromCompilerResult(
  result: ProjectIndexCompilerResult,
  input: {
    readonly status?: IndexPatchStatus
    readonly invalidates?: IndexPatch['invalidates']
    readonly finishedAt?: string
  } = {},
): IndexPatch {
  return {
    schemaVersion: 1,
    phase: 'runtime',
    project: result.project,
    startedAt: result.indexedAt,
    finishedAt: input.finishedAt ?? result.indexedAt,
    status: input.status ?? 'ok',
    ...(input.invalidates ? { invalidates: input.invalidates } : {}),
    facts: {
      prompts: result.facts.prompts,
      contexts: result.facts.contexts,
      tools: result.facts.tools,
      lint: result.facts.lint,
      definitions: result.facts.definitions,
      relations: result.facts.relations,
      diagnostics: result.diagnostics,
      lintFindings: result.lintFindings,
      ruleDescriptors: result.ruleDescriptors,
      sources: result.sources,
      sourceGraph: result.sourceGraph,
    },
  }
}

async function loadCompilerInputs(input: ProjectIndexCompilerInput): Promise<LoadedCompilerInputs> {
  const root = resolve(input.root)
  const indexedAt = input.indexedAt ?? new Date().toISOString()
  const configResult = await loadCompilerConfig(root, input)
  const staticSelection = staticDefinitionFileSelection(root)
  const diagnostics = [...configResult.diagnostics, ...staticSelectionDiagnostics(root, staticSelection)]
  const initial = createInitialCompilerInput({
    root,
    input,
    loaded: configResult.loaded,
    diagnostics,
    sources: configResult.sources,
  })

  return {
    root,
    indexedAt,
    loaded: configResult.loaded,
    staticSelection,
    initial,
  }
}

function discoverCompilerFacts(input: {
  readonly loadedInputs: LoadedCompilerInputs
  readonly extraction: StaticExtractionEngine
  readonly staticFileBatches?: readonly ProjectShardFileBatch[]
}): Promise<ProjectDiscoveryResult> {
  const { loadedInputs, extraction } = input
  return discoverProjectDefinitions({
    root: loadedInputs.root,
    loaded: loadedInputs.loaded,
    project: loadedInputs.initial.project,
    initialFacts: loadedInputs.initial.facts,
    diagnostics: loadedInputs.initial.diagnostics,
    sources: loadedInputs.initial.sources,
    staticFiles: loadedInputs.staticSelection.files,
    staticFileBatches: input.staticFileBatches,
    extraction,
  })
}

function loadCompilerConfig(root: string, input: ProjectIndexCompilerInput) {
  return loadProjectConfig(root, input.configPath, input.mode ?? DEFAULT_PROJECT_MODEL_RESOLUTION_MODE)
}

async function compilerRuntimeForLoadedInputs(input: {
  readonly root: string
  readonly baseRuntime: ProjectIndexCompilerRuntime
  readonly loaded: LoadedProjectConfig
}): Promise<{
  readonly runtime: ProjectIndexCompilerRuntime
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly cacheInputs: readonly IndexDependency[]
}> {
  const configuredExtensions = input.loaded.indexer?.extensions ?? []
  if (configuredExtensions.length === 0) {
    return { runtime: input.baseRuntime, diagnostics: [], cacheInputs: [] }
  }

  const loaded = await loadIndexerExtensionReferences({
    root: input.root,
    config: input.loaded.indexer,
  })
  if (loaded.extensions.length === 0) {
    return { runtime: input.baseRuntime, diagnostics: loaded.diagnostics, cacheInputs: [] }
  }

  return {
    runtime: createProjectIndexCompilerRuntime(
      compilerProfileWithResolvedExtensions(input.baseRuntime.profile, loaded.extensions),
    ),
    diagnostics: loaded.diagnostics,
    cacheInputs: extensionPackageCacheInputs(loaded.extensions),
  }
}

function extensionPackageCacheInputs(extensions: readonly ResolvedIndexerExtension[]): readonly IndexDependency[] {
  return staticExtensionPackageCacheInputs(
    extensions.map((extension) => ({
      packageName: extension.reference.package,
      exportName: extension.reference.export,
      packageVersion: extension.packageVersion,
    })),
  )
}

function appendInitialDiagnostics(
  loadedInputs: LoadedCompilerInputs,
  diagnostics: readonly IndexDiagnostic[],
): LoadedCompilerInputs {
  if (diagnostics.length === 0) return loadedInputs
  return {
    ...loadedInputs,
    initial: {
      ...loadedInputs.initial,
      diagnostics: [...loadedInputs.initial.diagnostics, ...diagnostics],
    },
  }
}

function withRuntimeStaticSelection(input: {
  readonly loadedInputs: LoadedCompilerInputs
  readonly runtime: ProjectIndexCompilerRuntime
}): LoadedCompilerInputs {
  const callNames = input.runtime.extensionRuntime.manifest.callNames
  const staticSelection = staticDefinitionFileSelection(input.loadedInputs.root, { additionalCallNames: callNames })
  return {
    ...input.loadedInputs,
    staticSelection,
    initial: {
      ...input.loadedInputs.initial,
      diagnostics: [
        ...input.loadedInputs.initial.diagnostics,
        ...staticSelectionDiagnostics(input.loadedInputs.root, staticSelection),
      ],
    },
  }
}

function staticSelectionDiagnostics(
  root: string,
  staticSelection: StaticDefinitionFileSelection,
): readonly IndexDiagnostic[] {
  return staticSelection.skipped
    .filter((candidate) => candidate.action === 'skip' && candidate.reason === 'too-large-authored')
    .map((candidate) => sourceTooLargeDiagnostic(root, candidate.file, candidate.bytes))
}

function createInitialCompilerInput(input: {
  readonly root: string
  readonly input: ProjectIndexCompilerInput
  readonly loaded: LoadedProjectConfig
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly sources: readonly IndexSourceFile[]
}): {
  readonly project: ProjectIdentity
  readonly facts: ProjectIndexInitialFacts
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly sources: readonly IndexSourceFile[]
} {
  const index = serializeIndex(
    input.loaded.crux?.prompts ? [...input.loaded.crux.prompts] : [],
    input.loaded.crux?.contexts ? [...input.loaded.crux.contexts] : [],
    undefined,
  )
  const derived = indexDefinitionsFromSnapshot(index)
  return {
    project: {
      root: input.root,
      ...(input.input.projectName ? { name: input.input.projectName } : {}),
      ...(input.loaded.configFile ? { configFile: input.loaded.configFile } : {}),
      ...runtimeProjectIdentity(input.loaded),
    },
    facts: {
      prompts: index.prompts,
      contexts: index.contexts,
      tools: index.tools,
      definitions: derived.definitions,
      relations: derived.relations,
    },
    diagnostics: [...derived.diagnostics, ...input.diagnostics],
    sources: [...derived.sources, ...input.sources],
  }
}

async function compilerResultFromDiscovery(input: CompilerSnapshotInput): Promise<ProjectIndexCompilerResult> {
  const {
    root,
    project,
    indexedAt,
    initialFacts,
    initialDiagnostics,
    initialSources,
    discovered,
    loaded,
    staticFiles,
  } = input
  const merged = await mergeCompilerFacts({
    root,
    initialFacts,
    initialDiagnostics,
    discovered,
    configFile: loaded.configFile,
    staticFiles,
  })
  const ruleResult = runCompilerIndexRules({
    extensionRuntime: input.extensionRuntime,
    definitions: merged.definitions,
    relations: merged.relations,
    runtime: runtimeLintContext(loaded),
  })
  const ruleDescriptors = compilerRuleDescriptors(input.extensionRuntime)
  const lintPolicy = applyCompilerLintPolicy({
    config: loaded.lint,
    configFile: loaded.configFile,
    diagnostics: [...merged.diagnostics, ...ruleResult.diagnostics],
    findings: ruleResult.outputs,
    files: staticFiles,
    ruleDescriptors,
  })
  const sourceGraph = projectCompilerSourceGraph(input.shards)
  const sources = projectCompilerSourceRows({
    sources: mergeSources([...initialSources, ...discovered.sources]),
    definitions: merged.definitions,
    relations: merged.relations,
    diagnostics: lintPolicy.diagnostics,
    discovered,
    shards: input.shards,
  })

  return {
    project,
    indexedAt,
    lint: loaded.lint,
    facts: {
      prompts: initialFacts.prompts,
      contexts: initialFacts.contexts,
      tools: initialFacts.tools,
      lint: loaded.lint,
      definitions: merged.definitions,
      relations: merged.relations,
      diagnostics: lintPolicy.diagnostics,
      lintFindings: lintPolicy.findings,
      ruleDescriptors,
      sources,
      sourceGraph,
    },
    sources,
    graphEvidence: discovered.sourceGraph,
    diagnostics: lintPolicy.diagnostics,
    lintFindings: lintPolicy.findings,
    ruleDescriptors,
    sourceGraph,
    semanticSourceProfile: semanticSourceProfileFromGraph(discovered.sourceGraph),
  }
}

function compilerRuleDescriptors(extensionRuntime: ExtensionRuntime): readonly IndexRuleDescriptor[] {
  const entries = [...builtInIndexRuleDescriptors(), ...extensionRuntime.ruleDescriptors]
  const seen = new Set<string>()
  const duplicateIds = []
  for (const entry of entries) {
    if (seen.has(entry.id)) duplicateIds.push(entry.id)
    seen.add(entry.id)
  }
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate Project Index rule descriptor ids: ${[...new Set(duplicateIds)].sort().join(', ')}`)
  }
  return entries
}

async function mergeCompilerFacts(input: {
  readonly root: string
  readonly initialFacts: ProjectIndexInitialFacts
  readonly initialDiagnostics: readonly IndexDiagnostic[]
  readonly discovered: ProjectDiscoveryResult
  readonly configFile: string | undefined
  readonly staticFiles: readonly string[]
}): Promise<MergedCompilerFacts> {
  const rawMergedDiagnostics = dedupeById([...input.initialDiagnostics, ...input.discovered.diagnostics])
  const definitionsWithSources = await mergeCompilerDefinitions(
    input.root,
    input.initialFacts.definitions,
    input.discovered.definitions,
    rawMergedDiagnostics,
    input.configFile,
    input.staticFiles,
  )
  const diagnostics = suppressRichImportDiagnosticsForStaticDefinitions(rawMergedDiagnostics, definitionsWithSources)
  const relationModel = resolveRelationModel({
    definitions: definitionsWithSources,
    relations: [...input.initialFacts.relations, ...input.discovered.relations],
  })
  return {
    definitions: relationModel.definitions,
    relations: relationModel.relations,
    diagnostics: dedupeById([...diagnostics, ...relationDiagnosticsFromReport(relationModel.report)]),
  }
}

function runCompilerIndexRules(input: {
  readonly extensionRuntime: ExtensionRuntime
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly runtime?: { readonly configured?: boolean }
}) {
  const extensionRules = input.extensionRuntime.checkRules({
    definitions: input.definitions,
    relations: input.relations,
    ...(input.runtime ? { runtime: input.runtime } : {}),
  })
  return {
    outputs: [
      ...indexLintFindings({
        definitions: input.definitions,
        relations: input.relations,
        ...(input.runtime ? { runtime: input.runtime } : {}),
      }),
      ...extensionRules.outputs,
    ],
    diagnostics: extensionRules.diagnostics,
  }
}

function runtimeLintContext(loaded: LoadedProjectConfig): { readonly configured: boolean } | undefined {
  if (loaded.importFailed) return undefined
  return { configured: Boolean(loaded.crux?.config.runtime) }
}

function runtimeProjectIdentity(loaded: LoadedProjectConfig): Pick<ProjectIdentity, 'runtimeConfigured'> {
  if (loaded.importFailed) return {}
  return { runtimeConfigured: Boolean(loaded.crux?.config.runtime) }
}

function applyCompilerLintPolicy(input: {
  readonly config: CruxLintConfig | undefined
  readonly configFile: string | undefined
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly findings: readonly IndexLintFinding[]
  readonly files: readonly string[]
  readonly ruleDescriptors: readonly IndexRuleDescriptor[]
}): {
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly findings: readonly IndexLintFinding[]
} {
  const diagnostics = [...input.diagnostics]
  const findings = applyIndexLintConfig({
    config: input.config,
    configFile: input.configFile,
    diagnostics,
    ruleDescriptors: input.ruleDescriptors,
    findings: applyIndexLintSuppressions({
      files: input.files,
      findings: [...input.findings],
      diagnostics,
      ruleDescriptors: input.ruleDescriptors,
    }),
  })
  return { diagnostics, findings }
}

function projectCompilerSourceGraph(shards: readonly ProjectIndexShard[]): ProjectIndexSnapshot['sourceGraph'] {
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
    shards: [...shards],
  }
}

async function mergeCompilerDefinitions(
  root: string,
  indexDefinitions: readonly ProjectDefinition[],
  discoveredDefinitions: readonly ProjectDefinition[],
  diagnostics: readonly IndexDiagnostic[],
  configFile: string | undefined,
  staticFiles: readonly string[],
): Promise<readonly ProjectDefinition[]> {
  const mergedDefinitions = mergeDefinitionsById([...indexDefinitions, ...discoveredDefinitions])
  const definitionsWithPaths = await backfillDefinitionPaths(root, mergedDefinitions, staticFiles)
  return backfillDefinitionSources(definitionsWithPaths, [...diagnostics], configFile)
}

function projectCompilerSourceRows(input: {
  readonly sources: readonly IndexSourceFile[]
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly discovered: ProjectDiscoveryResult
  readonly shards: readonly ProjectIndexShard[]
}): readonly IndexSourceFile[] {
  const graphBuilder = createIndexGraphBuilder()

  input.sources.forEach((source) => graphBuilder.addSource({ source }))
  input.definitions.forEach((definition) => graphBuilder.addDefinition({ definition }))
  input.relations.forEach((relation) => graphBuilder.addRelation({ relation }))
  input.diagnostics.forEach((diagnostic) => graphBuilder.addDiagnostic(diagnostic))
  dependenciesFromDiscovery(input.discovered).forEach(([file, dependency]) => {
    graphBuilder.addDependency(file, dependency)
  })
  dependenciesFromSourceRefs(input.definitions).forEach(([file, dependency]) => {
    graphBuilder.addDependency(file, dependency)
  })

  return graphSources(graphBuilder.graph).map((source) => ({
    ...source,
    shardId: source.shardId ?? shardIdForSourceFile(source.file, input.shards),
  }))
}

function dependenciesFromDiscovery(discovered: ProjectDiscoveryResult): ReadonlyArray<readonly [string, string]> {
  return [...discovered.sourceGraph.dependenciesByFile].flatMap(([file, dependencies]) =>
    dependencies.map((dependency) => [file, dependency] as const),
  )
}

function semanticSourceProfileFromGraph(graph: SourceGraph): SemanticSourceProfile | undefined {
  const profiles = [...(graph.semanticProfileByFile?.values() ?? [])].sort(compareSemanticProfileFiles)
  if (profiles.length === 0) return undefined
  const dependencyClosure = [
    ...new Set([
      ...profiles.map((profile) => profile.file),
      ...[...graph.dependenciesByFile.entries()].flatMap(([file, dependencies]) => [file, ...dependencies]),
    ]),
  ].sort()
  const profiledFiles = new Set(profiles.map((profile) => profile.file))
  return {
    files: profiles,
    dependencyClosure,
    sourceBytes: profiles.reduce((sum, profile) => sum + profile.sourceBytes, 0),
    complete: dependencyClosure.every((file) => profiledFiles.has(file)),
  }
}

function compareSemanticProfileFiles(left: SemanticSourceProfileFile, right: SemanticSourceProfileFile): number {
  return compareCodepoint(left.file, right.file)
}

function dependenciesFromSourceRefs(
  definitions: readonly ProjectDefinition[],
): ReadonlyArray<readonly [string, string]> {
  return definitions.flatMap((definition) => {
    const from = definition.source?.file
    if (!from) return []
    return (definition.sourceRefs ?? [])
      .map((ref) => ref.source.file)
      .filter((to): to is string => typeof to === 'string' && to.length > 0 && to !== from)
      .map((to) => [from, to] as const)
  })
}
