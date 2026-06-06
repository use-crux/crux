import { resolve } from 'node:path'
import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectCatalogSnapshot,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/catalog'
import { serializeProjectCatalog } from '@crux/core/catalog/serializers'
import { applyCatalogLintConfig } from '../catalog-lint-config'
import { applyCatalogLintSuppressions } from '../catalog-lint-suppressions'
import { catalogLintFindings } from '../catalog-lints'
import { loadProjectConfig, loadStaticOnlyProjectConfig, type LoadedProjectConfig } from '../config'
import { discoverProjectDefinitions, type ProjectDiscoveryResult } from '../discovery'
import { sourceTooLargeDiagnostic } from '../diagnostics'
import { staticDefinitionFileSelection, type StaticDefinitionFileSelection } from '../files'
import { createCatalogGraphBuilder, graphSources } from '../graph/builder'
import { dedupeById, mergeDefinitionsById } from '../merge'
import { backfillDefinitionPaths } from '../paths'
import { backfillDefinitionSources, mergeSources } from '../sources'
import type { ProjectIndexingSession, ProjectIndexingSessionOptions } from './types'
import { suppressRichImportDiagnosticsForStaticDefinitions } from './diagnostics'

export type { ProjectIndexingSession, ProjectIndexingSessionMode, ProjectIndexingSessionOptions } from './types'

interface ProjectIndexingSessionState {
  root: string
  indexedAt: string
  options: ProjectIndexingSessionOptions
  diagnostics: CatalogDiagnostic[]
  definitions: ProjectDefinition[]
  sources: Map<string, CatalogSourceFile>
}

interface SnapshotInput {
  catalog: ProjectCatalogSnapshot
  discovered: ProjectDiscoveryResult
  loaded: LoadedProjectConfig
  staticFiles: readonly string[]
}

/**
 * Creates a reusable indexing session object around one normalized project root.
 *
 * The session boundary exists so callers can exercise the full catalog lifecycle without
 * coupling tests to `indexProject` itself: config loading, static file selection, discovery,
 * merging, linting, graph population, and final snapshot shaping all stay behind `run()`.
 */
export function createProjectIndexingSession(options: ProjectIndexingSessionOptions): ProjectIndexingSession {
  const state = createProjectIndexingSessionState(options)
  return {
    run: () => runProjectIndexingSessionState(state),
  }
}

/**
 * Runs one full or source-only Project Catalog indexing session and returns the final snapshot.
 */
export async function runProjectIndexingSession(
  options: ProjectIndexingSessionOptions,
): Promise<ProjectCatalogSnapshot> {
  return createProjectIndexingSession(options).run()
}

/**
 * Runs the source-only catalog session used by AST patch generation.
 *
 * This mode parses authored source but does not import user config modules, which keeps
 * source-only indexing safe for projects whose config has runtime side effects.
 */
export async function runSourceOnlyProjectIndexingSession(
  options: Omit<ProjectIndexingSessionOptions, 'mode'>,
): Promise<ProjectCatalogSnapshot> {
  return runProjectIndexingSession({ ...options, mode: 'source-only' })
}

/**
 * Normalizes caller options into the explicit state shared by session helper functions.
 */
function createProjectIndexingSessionState(options: ProjectIndexingSessionOptions): ProjectIndexingSessionState {
  return {
    root: resolve(options.root),
    indexedAt: options.indexedAt ?? new Date().toISOString(),
    options,
    diagnostics: [],
    definitions: [],
    sources: new Map(),
  }
}

/**
 * Executes the indexing lifecycle for a prepared session state.
 */
async function runProjectIndexingSessionState(
  state: ProjectIndexingSessionState,
): Promise<ProjectCatalogSnapshot> {
  const loaded = await loadSessionConfig(state)
  const staticSelection = staticDefinitionFileSelection(state.root)
  recordStaticSelectionDiagnostics(state, staticSelection)

  const catalog = createInitialCatalog(state, loaded)
  const discovered = await discoverProjectDefinitions(
    state.root,
    loaded,
    catalog,
    state.diagnostics,
    state.sources,
    staticSelection.files,
  )

  return createSnapshot(state, { catalog, discovered, loaded, staticFiles: staticSelection.files })
}

/**
 * Loads config according to the session mode while preserving source-only import safety.
 */
async function loadSessionConfig(state: ProjectIndexingSessionState): Promise<LoadedProjectConfig> {
  if (state.options.mode === 'source-only') {
    return loadStaticOnlyProjectConfig(state.root, state.options.configPath, state.diagnostics, state.sources)
  }
  return loadProjectConfig(state.root, state.options.configPath, state.diagnostics, state.sources)
}

/**
 * Converts static file-selection skips into catalog diagnostics owned by this session.
 */
function recordStaticSelectionDiagnostics(
  state: ProjectIndexingSessionState,
  staticSelection: StaticDefinitionFileSelection,
): void {
  state.diagnostics.push(
    ...staticSelection.skipped
      .filter((candidate) => candidate.action === 'skip' && candidate.reason === 'too-large-authored')
      .map((candidate) => sourceTooLargeDiagnostic(state.root, candidate.file, candidate.bytes)),
  )
}

/**
 * Creates the initial serialized catalog from imported config facts and session diagnostics.
 */
function createInitialCatalog(
  state: ProjectIndexingSessionState,
  loaded: LoadedProjectConfig,
): ProjectCatalogSnapshot {
  return serializeProjectCatalog({
    project: {
      root: state.root,
      ...(state.options.projectName ? { name: state.options.projectName } : {}),
      ...(loaded.configFile ? { configFile: loaded.configFile } : {}),
    },
    lint: loaded.lint,
    prompts: loaded.crux?.prompts ? [...loaded.crux.prompts] : [],
    contexts: loaded.crux?.contexts ? [...loaded.crux.contexts] : [],
    tools: loaded.crux?.config.tools,
    indexedAt: state.indexedAt,
    definitions: state.definitions,
    relations: [],
    diagnostics: state.diagnostics,
    sources: [...state.sources.values()],
  })
}

/**
 * Builds the final catalog snapshot by merging discovery results with config/static facts.
 */
async function createSnapshot(
  state: ProjectIndexingSessionState,
  input: SnapshotInput,
): Promise<ProjectCatalogSnapshot> {
  const { catalog, discovered, loaded, staticFiles } = input
  const rawMergedDiagnostics = dedupeById([...catalog.diagnostics, ...state.diagnostics, ...discovered.diagnostics])
  const definitionsWithSources = await mergeSnapshotDefinitions(
    state.root,
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
  const lintFindings = applyCatalogLintConfig({
    config: loaded.lint,
    configFile: loaded.configFile,
    diagnostics: mergedDiagnostics,
    findings: applyCatalogLintSuppressions({
      files: staticFiles,
      findings: catalogLintFindings({ definitions: definitionsWithSources, relations }),
      diagnostics: mergedDiagnostics,
    }),
  })

  return {
    ...catalog,
    sourceGraph: {
      schemaVersion: 1,
      producedBy: '@crux/source-indexer',
      capabilities: ['source-dependencies', 'source-dependents', 'definition-ownership', 'diagnostic-ownership'],
    },
    definitions: definitionsWithSources,
    relations,
    diagnostics: mergedDiagnostics,
    lintFindings,
    sources: createGraphSources({
      sources: mergeSources([...catalog.sources, ...state.sources.values(), ...discovered.sources]),
      definitions: definitionsWithSources,
      relations,
      diagnostics: mergedDiagnostics,
      discovered,
    }),
  }
}

/**
 * Merges definition facts, then backfills path and source information from diagnostics/config.
 */
async function mergeSnapshotDefinitions(
  root: string,
  catalogDefinitions: readonly ProjectDefinition[],
  discoveredDefinitions: readonly ProjectDefinition[],
  diagnostics: readonly CatalogDiagnostic[],
  configFile: string | undefined,
  staticFiles: readonly string[],
): Promise<ProjectDefinition[]> {
  const mergedDefinitions = mergeDefinitionsById([...catalogDefinitions, ...discoveredDefinitions])
  const definitionsWithPaths = await backfillDefinitionPaths(root, mergedDefinitions, staticFiles)
  return backfillDefinitionSources(definitionsWithPaths, [...diagnostics], configFile)
}

/**
 * Creates source graph read-model rows from merged sources, definitions, relations, and dependencies.
 */
function createGraphSources(input: {
  sources: CatalogSourceFile[]
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  discovered: ProjectDiscoveryResult
}): CatalogSourceFile[] {
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

/**
 * Flattens discovery source-graph dependencies into graph-builder edge tuples.
 */
function dependenciesFromDiscovery(discovered: ProjectDiscoveryResult): Array<readonly [string, string]> {
  return [...discovered.sourceGraph.dependenciesByFile].flatMap(([file, dependencies]) =>
    dependencies.map((dependency) => [file, dependency] as const),
  )
}

/**
 * Converts definition `sourceRefs` into file dependency tuples for the source graph.
 */
function dependenciesFromSourceRefs(definitions: readonly ProjectDefinition[]): Array<readonly [string, string]> {
  return definitions.flatMap((definition) => {
    const from = definition.source?.file
    if (!from) return []
    return (definition.sourceRefs ?? [])
      .map((ref) => ref.source.file)
      .filter((to): to is string => typeof to === 'string' && to.length > 0 && to !== from)
      .map((to) => [from, to] as const)
  })
}
