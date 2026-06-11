import { resolve } from 'node:path'
import type {
  ContextMeta,
  IndexDiagnostic,
  IndexLintFinding,
  IndexRuleDescriptor,
  IndexSourceFile,
  CruxLintConfig,
  ProjectIndexSnapshot,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  PromptMeta,
  ToolMeta,
} from '@crux/core/project-index'
import { indexDefinitionsFromSnapshot, serializeIndex } from '@crux/core/project-index/serializers'
import { applyIndexLintConfig } from '../lints/config'
import { applyIndexLintSuppressions } from '../lints/suppressions'
import { builtInIndexRuleDescriptors } from '../lints/rules'
import { loadProjectConfig, loadStaticOnlyProjectConfig, type LoadedProjectConfig } from '../config'
import { discoverProjectDefinitions, type ProjectDiscoveryResult } from '../discovery'
import { sourceTooLargeDiagnostic } from '../diagnostics'
import { loadIndexerExtensionReferences, type IndexerExtensionRuntime as ExtensionRuntime } from '../extensions'
import { staticDefinitionFileSelection, type StaticDefinitionFileSelection } from '../files'
import { createIndexGraphBuilder, graphSources } from '../graph/builder'
import { dedupeById, mergeDefinitionsById } from '../merge'
import { type IndexPatch, type IndexPatchFacts, type IndexPatchStatus } from '../patches'
import { backfillDefinitionPaths } from '../paths'
import { relationDiagnosticsFromReport, resolveRelationModel } from '../relations/index'
import { backfillDefinitionSources, mergeSources } from '../sources'
import { createStaticExtraction, type StaticExtractionEngine } from '../static/extraction/engine'
import type { SourceGraph } from '../types'
import { suppressRichImportDiagnosticsForStaticDefinitions } from './diagnostics'
import {
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
  type ProjectIndexCompilerRuntime,
  type ProjectIndexCompilerProfile,
} from './profile'

export type ProjectIndexCompileMode = 'full' | 'source-only'

export interface ProjectIndexCompilerInput {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  readonly mode?: ProjectIndexCompileMode
  readonly indexedAt?: string
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
  readonly extensionRuntime: ExtensionRuntime
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
  })
  const loadedInputsWithExtensionDiagnostics = appendInitialDiagnostics(
    loadedInputsWithRuntimeSelection,
    runtimeResult.diagnostics,
  )
  const discovered = await discoverCompilerFacts({
    loadedInputs: loadedInputsWithExtensionDiagnostics,
    extraction,
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
    extensionRuntime: runtimeResult.runtime.extensionRuntime,
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
    extraction,
  })
}

function loadCompilerConfig(root: string, input: ProjectIndexCompilerInput) {
  if (input.mode === 'source-only') {
    return loadStaticOnlyProjectConfig(root, input.configPath)
  }
  return loadProjectConfig(root, input.configPath)
}

async function compilerRuntimeForLoadedInputs(input: {
  readonly root: string
  readonly baseRuntime: ProjectIndexCompilerRuntime
  readonly loaded: LoadedProjectConfig
}): Promise<{
  readonly runtime: ProjectIndexCompilerRuntime
  readonly diagnostics: readonly IndexDiagnostic[]
}> {
  const configuredExtensions = input.loaded.indexer?.extensions ?? []
  if (configuredExtensions.length === 0) {
    return { runtime: input.baseRuntime, diagnostics: [] }
  }

  const loaded = await loadIndexerExtensionReferences({
    root: input.root,
    config: input.loaded.indexer,
  })
  if (loaded.extensions.length === 0) {
    return { runtime: input.baseRuntime, diagnostics: loaded.diagnostics }
  }

  return {
    runtime: createProjectIndexCompilerRuntime({
      ...input.baseRuntime.profile,
      extensions: [...input.baseRuntime.profile.extensions, ...loaded.extensions.map((entry) => entry.extension)],
    }),
    diagnostics: loaded.diagnostics,
  }
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
    input.loaded.crux?.config.tools ? [...input.loaded.crux.config.tools] : undefined,
  )
  const derived = indexDefinitionsFromSnapshot(index)
  return {
    project: {
      root: input.root,
      ...(input.input.projectName ? { name: input.input.projectName } : {}),
      ...(input.loaded.configFile ? { configFile: input.loaded.configFile } : {}),
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
  })
  const lintPolicy = applyCompilerLintPolicy({
    config: loaded.lint,
    configFile: loaded.configFile,
    diagnostics: [...merged.diagnostics, ...ruleResult.diagnostics],
    findings: ruleResult.outputs,
    files: staticFiles,
  })
  const sourceGraph = projectCompilerSourceGraph()
  const ruleDescriptors = compilerRuleDescriptors(input.extensionRuntime)
  const sources = projectCompilerSourceRows({
    sources: mergeSources([...initialSources, ...discovered.sources]),
    definitions: merged.definitions,
    relations: merged.relations,
    diagnostics: lintPolicy.diagnostics,
    discovered,
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
}) {
  return input.extensionRuntime.checkRules({
    definitions: input.definitions,
    relations: input.relations,
  })
}

function applyCompilerLintPolicy(input: {
  readonly config: CruxLintConfig | undefined
  readonly configFile: string | undefined
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly findings: readonly IndexLintFinding[]
  readonly files: readonly string[]
}): {
  readonly diagnostics: readonly IndexDiagnostic[]
  readonly findings: readonly IndexLintFinding[]
} {
  const diagnostics = [...input.diagnostics]
  const findings = applyIndexLintConfig({
    config: input.config,
    configFile: input.configFile,
    diagnostics,
    findings: applyIndexLintSuppressions({
      files: input.files,
      findings: [...input.findings],
      diagnostics,
    }),
  })
  return { diagnostics, findings }
}

function projectCompilerSourceGraph(): ProjectIndexSnapshot['sourceGraph'] {
  return {
    schemaVersion: 1,
    producedBy: '@crux/indexer',
    capabilities: ['source-dependencies', 'source-dependents', 'definition-ownership', 'diagnostic-ownership'],
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

  return graphSources(graphBuilder.graph)
}

function dependenciesFromDiscovery(discovered: ProjectDiscoveryResult): ReadonlyArray<readonly [string, string]> {
  return [...discovered.sourceGraph.dependenciesByFile].flatMap(([file, dependencies]) =>
    dependencies.map((dependency) => [file, dependency] as const),
  )
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
