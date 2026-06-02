import { resolve } from 'node:path'
import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectCatalogSnapshot,
  ProjectDefinition,
} from '@crux/core/catalog'
import { serializeProjectCatalog } from '@crux/core/catalog/serializers'
import { loadProjectConfig, loadStaticOnlyProjectConfig } from './config'
import { discoverProjectDefinitions } from './discovery'
import { sourceTooLargeDiagnostic } from './diagnostics'
import { staticDefinitionFileSelection } from './files'
import { createCatalogGraphBuilder, graphSources } from './graph/builder'
import { dedupeById, mergeDefinitionsById } from './merge'
import { backfillDefinitionPaths } from './paths'
import { backfillDefinitionSources, mergeSources } from './sources'
import { catalogLintFindings } from './catalog-lints'
import { applyCatalogLintSuppressions } from './catalog-lint-suppressions'
import { applyCatalogLintConfig } from './catalog-lint-config'

export interface IndexProjectOptions {
  root: string
  configPath?: string
  projectName?: string
  staticOnly?: boolean
}

export async function indexProject(options: IndexProjectOptions): Promise<ProjectCatalogSnapshot> {
  const root = resolve(options.root)
  const indexedAt = new Date().toISOString()
  const diagnostics: CatalogDiagnostic[] = []
  const definitions: ProjectDefinition[] = []
  const sources = new Map<string, CatalogSourceFile>()

  const loaded = options.staticOnly
    ? loadStaticOnlyProjectConfig(root, options.configPath, diagnostics, sources)
    : await loadProjectConfig(root, options.configPath, diagnostics, sources)
  const staticSelection = staticDefinitionFileSelection(root)
  diagnostics.push(
    ...staticSelection.skipped
      .filter((candidate) => candidate.action === 'skip' && candidate.reason === 'too-large-authored')
      .map((candidate) => sourceTooLargeDiagnostic(root, candidate.file, candidate.bytes)),
  )
  const project = {
    root,
    ...(options.projectName ? { name: options.projectName } : {}),
    ...(loaded.configFile ? { configFile: loaded.configFile } : {}),
  }

  const catalog = serializeProjectCatalog({
    project,
    lint: loaded.lint,
    prompts: loaded.crux?.prompts ? [...loaded.crux.prompts] : [],
    contexts: loaded.crux?.contexts ? [...loaded.crux.contexts] : [],
    tools: loaded.crux?.config.tools,
    indexedAt,
    definitions,
    relations: [],
    diagnostics,
    sources: [...sources.values()],
  })

  const discovered = await discoverProjectDefinitions(root, loaded, catalog, diagnostics, sources, staticSelection.files)
  const rawMergedDiagnostics = dedupeById([...catalog.diagnostics, ...diagnostics, ...discovered.diagnostics])
  const mergedDefinitions = mergeDefinitionsById([...catalog.definitions, ...discovered.definitions])
  const definitionsWithPaths = await backfillDefinitionPaths(root, mergedDefinitions, staticSelection.files)
  const definitionsWithSources = backfillDefinitionSources(definitionsWithPaths, rawMergedDiagnostics, loaded.configFile)
  const mergedDiagnostics = suppressRichImportDiagnosticsForStaticDefinitions(rawMergedDiagnostics, definitionsWithSources)
  const relations = dedupeById([...catalog.relations, ...discovered.relations])
  const lintFindings = applyCatalogLintConfig({
    config: loaded.lint,
    configFile: loaded.configFile,
    diagnostics: mergedDiagnostics,
    findings: applyCatalogLintSuppressions({
    files: staticSelection.files,
    findings: catalogLintFindings({ definitions: definitionsWithSources, relations }),
    diagnostics: mergedDiagnostics,
    }),
  })
  const mergedSources = mergeSources([...catalog.sources, ...sources.values(), ...discovered.sources])
  const graphBuilder = createCatalogGraphBuilder()

  for (const source of mergedSources) graphBuilder.addSource({ source })
  for (const definition of definitionsWithSources) graphBuilder.addDefinition({ definition })
  for (const relation of relations) graphBuilder.addRelation({ relation })
  for (const diagnostic of mergedDiagnostics) graphBuilder.addDiagnostic(diagnostic)
  for (const [file, dependencies] of discovered.sourceGraph.dependenciesByFile) {
    for (const dependency of dependencies) graphBuilder.addDependency(file, dependency)
  }
  for (const definition of definitionsWithSources) {
    const from = definition.source?.file
    if (!from) continue
    for (const ref of definition.sourceRefs ?? []) {
      const to = ref.source.file
      if (!to || to === from) continue
      graphBuilder.addDependency(from, to)
    }
  }

  return {
    ...catalog,
    definitions: definitionsWithSources,
    relations,
    diagnostics: mergedDiagnostics,
    lintFindings,
    sources: graphSources(graphBuilder.graph),
  }
}

function suppressRichImportDiagnosticsForStaticDefinitions(
  diagnostics: CatalogDiagnostic[],
  definitions: ProjectDefinition[],
): CatalogDiagnostic[] {
  const definitionFiles = new Set(
    definitions
      .map((definitionItem) => definitionItem.source?.file)
      .filter((file): file is string => typeof file === 'string' && file.length > 0),
  )

  return diagnostics.filter((diagnostic) => {
    if (diagnostic.code !== 'catalog.rich_import_failed') return true
    const file = diagnostic.source?.file
    return !(file && definitionFiles.has(file))
  })
}
