import { resolve } from 'node:path'
import type {
  CatalogDiagnostic,
  CatalogLintFinding,
  CatalogSourceFile,
  CruxLintConfig,
  ProjectCatalogSnapshot,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
} from '@crux/core/catalog'
import { serializeProjectCatalog } from '@crux/core/catalog/serializers'
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
import type { SourceGraph } from '../types'
import { suppressRichImportDiagnosticsForStaticDefinitions } from '../session/diagnostics'

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
  readonly catalog: ProjectCatalogSnapshot
  readonly discovered: ProjectDiscoveryResult
  readonly loaded: LoadedProjectConfig
  readonly staticFiles: readonly string[]
}

export async function compileProjectCatalog(input: ProjectCatalogCompilerInput): Promise<ProjectCatalogCompilerResult> {
  const root = resolve(input.root)
  const indexedAt = input.indexedAt ?? new Date().toISOString()
  const configResult = await loadCompilerConfig(root, input)
  const staticSelection = staticDefinitionFileSelection(root)
  const diagnostics = [...configResult.diagnostics, ...staticSelectionDiagnostics(root, staticSelection)]
  const catalog = createInitialCatalog({
    root,
    indexedAt,
    input,
    loaded: configResult.loaded,
    diagnostics,
    sources: configResult.sources,
  })
  const discovered = await discoverProjectDefinitions({
    root,
    loaded: configResult.loaded,
    catalog,
    diagnostics,
    sources: configResult.sources,
    staticFiles: staticSelection.files,
  })

  return compilerResultFromDiscovery({
    root,
    catalog,
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

function createInitialCatalog(input: {
  readonly root: string
  readonly indexedAt: string
  readonly input: ProjectCatalogCompilerInput
  readonly loaded: LoadedProjectConfig
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
}): ProjectCatalogSnapshot {
  return serializeProjectCatalog({
    project: {
      root: input.root,
      ...(input.input.projectName ? { name: input.input.projectName } : {}),
      ...(input.loaded.configFile ? { configFile: input.loaded.configFile } : {}),
    },
    lint: input.loaded.lint,
    prompts: input.loaded.crux?.prompts ? [...input.loaded.crux.prompts] : [],
    contexts: input.loaded.crux?.contexts ? [...input.loaded.crux.contexts] : [],
    tools: input.loaded.crux?.config.tools,
    indexedAt: input.indexedAt,
    definitions: [],
    relations: [],
    diagnostics: [...input.diagnostics],
    sources: [...input.sources],
  })
}

async function compilerResultFromDiscovery(input: CompilerSnapshotInput): Promise<ProjectCatalogCompilerResult> {
  const { root, catalog, discovered, loaded, staticFiles } = input
  const rawMergedDiagnostics = dedupeById([...catalog.diagnostics, ...discovered.diagnostics])
  const definitionsWithSources = await mergeCompilerDefinitions(
    root,
    catalog.definitions,
    discovered.definitions,
    rawMergedDiagnostics,
    loaded.configFile,
    staticFiles,
  )
  const mergedDiagnostics = suppressRichImportDiagnosticsForStaticDefinitions(
    rawMergedDiagnostics,
    definitionsWithSources,
  )
  const relations = dedupeById([...catalog.relations, ...discovered.relations])
  const ruleResult = sourceIndexerExtensionRuntime.checkRules({
    definitions: definitionsWithSources,
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
    sources: mergeSources([...catalog.sources, ...discovered.sources]),
    definitions: definitionsWithSources,
    relations,
    diagnostics,
    discovered,
  })

  return {
    project: catalog.project,
    indexedAt: catalog.indexedAt,
    lint: loaded.lint,
    facts: {
      prompts: catalog.prompts,
      contexts: catalog.contexts,
      tools: catalog.tools,
      lint: loaded.lint,
      definitions: definitionsWithSources,
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
