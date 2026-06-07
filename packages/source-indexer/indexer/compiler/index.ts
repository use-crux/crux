import { resolve } from 'node:path'
import type {
  ContextMeta,
  CatalogDiagnostic,
  CatalogLintFinding,
  CatalogSourceFile,
  CruxLintConfig,
  ProjectCatalogSnapshot,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  PromptMeta,
  ToolMeta,
} from '@crux/core/catalog'
import { catalogDefinitionsFromSnapshot, serializeCatalog } from '@crux/core/catalog/serializers'
import { applyCatalogLintConfig } from '../catalog-lint-config'
import { applyCatalogLintSuppressions } from '../catalog-lint-suppressions'
import { loadProjectConfig, loadStaticOnlyProjectConfig, type LoadedProjectConfig } from '../config'
import { discoverProjectDefinitions, type ProjectDiscoveryResult } from '../discovery'
import { sourceTooLargeDiagnostic } from '../diagnostics'
import { sourceIndexerExtensionRuntime } from '../extractors/registry'
import { staticDefinitionFileSelection, type StaticDefinitionFileSelection } from '../files'
import { createCatalogGraphBuilder, graphSources } from '../graph/builder'
import { dedupeById, mergeDefinitionsById } from '../merge'
import { type CatalogPatch, type CatalogPatchFacts, type CatalogPatchStatus } from '../patches'
import { backfillDefinitionPaths } from '../paths'
import { backfillDefinitionSources, mergeSources } from '../sources'
import { withResolvedInjectionReadModel } from '../static-file'
import type { SourceGraph } from '../types'
import { suppressRichImportDiagnosticsForStaticDefinitions } from './diagnostics'

export type ProjectCatalogCompileMode = 'full' | 'source-only'

export interface ProjectCatalogCompilerInput {
  readonly root: string
  readonly configPath?: string
  readonly projectName?: string
  readonly mode?: ProjectCatalogCompileMode
  readonly indexedAt?: string
}

export interface ProjectCatalogCompilerResult {
  readonly project: ProjectIdentity
  readonly indexedAt: string
  readonly lint?: CruxLintConfig
  readonly facts: CatalogPatchFacts
  readonly sources: readonly CatalogSourceFile[]
  readonly graphEvidence: SourceGraph
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly lintFindings: readonly CatalogLintFinding[]
  readonly sourceGraph?: ProjectCatalogSnapshot['sourceGraph']
}

interface CompilerSnapshotInput {
  readonly root: string
  readonly project: ProjectIdentity
  readonly indexedAt: string
  readonly initialFacts: ProjectCatalogInitialFacts
  readonly initialDiagnostics: readonly CatalogDiagnostic[]
  readonly initialSources: readonly CatalogSourceFile[]
  readonly discovered: ProjectDiscoveryResult
  readonly loaded: LoadedProjectConfig
  readonly staticFiles: readonly string[]
}

interface ProjectCatalogInitialFacts {
  readonly prompts: readonly PromptMeta[]
  readonly contexts: readonly ContextMeta[]
  readonly tools?: readonly ToolMeta[]
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

export async function compileProjectCatalog(input: ProjectCatalogCompilerInput): Promise<ProjectCatalogCompilerResult> {
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
  const discovered = await discoverProjectDefinitions({
    root,
    loaded: configResult.loaded,
    project: initial.project,
    initialFacts: initial.facts,
    diagnostics: initial.diagnostics,
    sources: initial.sources,
    staticFiles: staticSelection.files,
  })

  return compilerResultFromDiscovery({
    root,
    project: initial.project,
    indexedAt,
    initialFacts: initial.facts,
    initialDiagnostics: initial.diagnostics,
    initialSources: initial.sources,
    discovered,
    loaded: configResult.loaded,
    staticFiles: staticSelection.files,
  })
}

export function projectCatalogSnapshotFromCompilerResult(result: ProjectCatalogCompilerResult): ProjectCatalogSnapshot {
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
    sources: [...result.sources],
    sourceGraph: result.sourceGraph,
  }
}

export function astCatalogPatchFromCompilerResult(
  result: ProjectCatalogCompilerResult,
  input: {
    readonly status?: CatalogPatchStatus
    readonly invalidates?: CatalogPatch['invalidates']
    readonly finishedAt?: string
  } = {},
): CatalogPatch {
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
      sources: result.sources,
      sourceGraph: result.sourceGraph,
    },
  }
}

function loadCompilerConfig(root: string, input: ProjectCatalogCompilerInput) {
  if (input.mode === 'source-only') {
    return loadStaticOnlyProjectConfig(root, input.configPath)
  }
  return loadProjectConfig(root, input.configPath)
}

function staticSelectionDiagnostics(
  root: string,
  staticSelection: StaticDefinitionFileSelection,
): readonly CatalogDiagnostic[] {
  return staticSelection.skipped
    .filter((candidate) => candidate.action === 'skip' && candidate.reason === 'too-large-authored')
    .map((candidate) => sourceTooLargeDiagnostic(root, candidate.file, candidate.bytes))
}

function createInitialCompilerInput(input: {
  readonly root: string
  readonly input: ProjectCatalogCompilerInput
  readonly loaded: LoadedProjectConfig
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
}): {
  readonly project: ProjectIdentity
  readonly facts: ProjectCatalogInitialFacts
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
} {
  const catalog = serializeCatalog(
    input.loaded.crux?.prompts ? [...input.loaded.crux.prompts] : [],
    input.loaded.crux?.contexts ? [...input.loaded.crux.contexts] : [],
    undefined,
    input.loaded.crux?.config.tools ? [...input.loaded.crux.config.tools] : undefined,
  )
  const derived = catalogDefinitionsFromSnapshot(catalog)
  return {
    project: {
      root: input.root,
      ...(input.input.projectName ? { name: input.input.projectName } : {}),
      ...(input.loaded.configFile ? { configFile: input.loaded.configFile } : {}),
    },
    facts: {
      prompts: catalog.prompts,
      contexts: catalog.contexts,
      tools: catalog.tools,
      definitions: derived.definitions,
      relations: derived.relations,
    },
    diagnostics: [...derived.diagnostics, ...input.diagnostics],
    sources: [...derived.sources, ...input.sources],
  }
}

async function compilerResultFromDiscovery(input: CompilerSnapshotInput): Promise<ProjectCatalogCompilerResult> {
  const { root, project, indexedAt, initialFacts, initialDiagnostics, initialSources, discovered, loaded, staticFiles } =
    input
  const rawMergedDiagnostics = dedupeById([...initialDiagnostics, ...discovered.diagnostics])
  const definitionsWithSources = await mergeCompilerDefinitions(
    root,
    initialFacts.definitions,
    discovered.definitions,
    rawMergedDiagnostics,
    loaded.configFile,
    staticFiles,
  )
  const mergedDiagnostics = suppressRichImportDiagnosticsForStaticDefinitions(
    rawMergedDiagnostics,
    definitionsWithSources,
  )
  const relations = dedupeById([...initialFacts.relations, ...discovered.relations])
  const definitions = withResolvedInjectionReadModel(definitionsWithSources, relations)
  const ruleResult = sourceIndexerExtensionRuntime.checkRules({
    definitions,
    relations,
  })
  const diagnostics = [...mergedDiagnostics, ...ruleResult.diagnostics]
  const lintFindings = applyCatalogLintConfig({
    config: loaded.lint,
    configFile: loaded.configFile,
    diagnostics,
    findings: applyCatalogLintSuppressions({
      files: staticFiles,
      findings: ruleResult.outputs,
      diagnostics,
    }),
  })
  const sourceGraph = {
    schemaVersion: 1,
    producedBy: '@crux/source-indexer',
    capabilities: ['source-dependencies', 'source-dependents', 'definition-ownership', 'diagnostic-ownership'],
  } as const satisfies ProjectCatalogSnapshot['sourceGraph']
  const sources = createGraphSources({
    sources: mergeSources([...initialSources, ...discovered.sources]),
    definitions,
    relations,
    diagnostics,
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
      definitions,
      relations,
      diagnostics,
      lintFindings,
      sources,
      sourceGraph,
    },
    sources,
    graphEvidence: discovered.sourceGraph,
    diagnostics,
    lintFindings,
    sourceGraph,
  }
}

async function mergeCompilerDefinitions(
  root: string,
  catalogDefinitions: readonly ProjectDefinition[],
  discoveredDefinitions: readonly ProjectDefinition[],
  diagnostics: readonly CatalogDiagnostic[],
  configFile: string | undefined,
  staticFiles: readonly string[],
): Promise<readonly ProjectDefinition[]> {
  const mergedDefinitions = mergeDefinitionsById([...catalogDefinitions, ...discoveredDefinitions])
  const definitionsWithPaths = await backfillDefinitionPaths(root, mergedDefinitions, staticFiles)
  return backfillDefinitionSources(definitionsWithPaths, [...diagnostics], configFile)
}

function createGraphSources(input: {
  readonly sources: readonly CatalogSourceFile[]
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly discovered: ProjectDiscoveryResult
}): readonly CatalogSourceFile[] {
  const graphBuilder = createCatalogGraphBuilder()

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
