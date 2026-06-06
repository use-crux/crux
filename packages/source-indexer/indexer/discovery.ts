import { readFile } from 'node:fs/promises'
import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectCatalogSnapshot,
  ProjectDefinition,
  ProjectRelation,
} from '@crux/core/catalog'
import type { LoadedProjectConfig } from './config'
import { foldedCatalogChild } from './catalog-presentation'
import { definition, relation, safeId } from './definitions'
import {
  suiteJsonInvalidDiagnostic,
  suiteJsonReadFailedDiagnostic,
} from './diagnostics'
import { discoverRuntimeEvalDefinitions } from './eval-discovery'
import { isPortableSuiteJson } from './evaluations'
import { evalGlobs, suiteJsonFiles } from './files'
import {
  discoverResolvedDefinitionsFromStaticCandidates,
  discoverStaticDefinitions,
} from './static-discovery'
import { addSource } from './sources'
import type { SourceGraph } from './types'

export interface ProjectDiscoveryResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  sources: CatalogSourceFile[]
  sourceGraph: SourceGraph
}

export async function discoverProjectDefinitions(
  root: string,
  loaded: LoadedProjectConfig,
  catalog: ProjectCatalogSnapshot,
  diagnostics: CatalogDiagnostic[],
  sources: Map<string, CatalogSourceFile>,
  staticFiles: readonly string[],
): Promise<ProjectDiscoveryResult> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const localDiagnostics: CatalogDiagnostic[] = []
  const sourceGraph: SourceGraph = { dependenciesByFile: new Map() }
  const promptIds = new Set(catalog.prompts.map((prompt) => prompt.id).filter((id): id is string => typeof id === 'string'))

  const failedImportFiles: string[] = []
  if (!loaded.staticOnly) {
    const evalResult = await discoverRuntimeEvalDefinitions(root, evalGlobs(loaded), promptIds, diagnostics, sources)
    definitions.push(...evalResult.definitions)
    relations.push(...evalResult.relations)
    failedImportFiles.push(...evalResult.failedImportFiles)

    const resolvedRich = await discoverResolvedDefinitionsFromStaticCandidates(root, diagnostics, sources, staticFiles)
    definitions.push(...resolvedRich.definitions)
    relations.push(...resolvedRich.relations)
    failedImportFiles.push(...resolvedRich.failedImportFiles)
    mergeSourceGraph(sourceGraph, resolvedRich.sourceGraph)
  }

  const knownDefinitionIds = new Set([...catalog.definitions.map((definitionItem) => definitionItem.id), ...definitions.map((definitionItem) => definitionItem.id)])
  const staticResult = await discoverStaticDefinitions(root, loaded, catalog, failedImportFiles, sources, knownDefinitionIds, staticFiles)
  definitions.push(...staticResult.definitions)
  relations.push(...staticResult.relations)
  localDiagnostics.push(...staticResult.diagnostics)
  mergeSourceGraph(sourceGraph, staticResult.sourceGraph)

  const suiteResult = await discoverSuiteJsonDefinitions(root, loaded, sources)
  definitions.push(...suiteResult.definitions)
  relations.push(...suiteResult.relations)
  localDiagnostics.push(...suiteResult.diagnostics)

  return {
    definitions,
    relations,
    diagnostics: localDiagnostics,
    sources: [...sources.values()],
    sourceGraph,
  }
}

function mergeSourceGraph(target: SourceGraph, incoming: SourceGraph): void {
  for (const [file, dependencies] of incoming.dependenciesByFile) {
    target.dependenciesByFile.set(file, [...new Set([...(target.dependenciesByFile.get(file) ?? []), ...dependencies])].sort())
  }
}

async function discoverSuiteJsonDefinitions(
  root: string,
  loaded: LoadedProjectConfig,
  sources: Map<string, CatalogSourceFile>,
): Promise<{
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
}> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const diagnostics: CatalogDiagnostic[] = []

  for (const jsonFile of suiteJsonFiles(root, loaded)) {
    addSource(sources, jsonFile, 'indexed')
    try {
      const raw = await readFile(jsonFile, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!isPortableSuiteJson(parsed)) {
        diagnostics.push(suiteJsonInvalidDiagnostic(jsonFile))
        addSource(sources, jsonFile, 'partial')
        continue
      }
      const suiteId = `suite:${safeId(parsed.id)}`
      definitions.push(await definition(root, jsonFile, suiteId, 'suite', parsed.id, parsed.description, {
        source: 'json',
        caseCount: parsed.cases.length,
        facts: {
          kind: 'suite',
          caseCount: parsed.cases.length,
        },
      }))
      for (const [index, testCase] of parsed.cases.entries()) {
        const caseId = `suite.case:${safeId(parsed.id)}:${safeId(testCase.id)}`
        definitions.push(await definition(root, jsonFile, caseId, 'suite.case', testCase.name ?? testCase.id, undefined, {
          suiteId: parsed.id,
          facts: {
            kind: 'suite.case',
            suiteId: parsed.id,
          },
          catalogPresentation: foldedCatalogChild({
            parentDefinitionId: suiteId,
            parentRelationType: 'suite.includes_case',
            role: 'case',
            order: index,
          }),
          tags: testCase.tags,
        }))
        relations.push(relation('suite.includes_case', suiteId, caseId, jsonFile))
      }
    } catch (error) {
      diagnostics.push(suiteJsonReadFailedDiagnostic(jsonFile, errorMessage(error)))
      addSource(sources, jsonFile, 'error')
    }
  }

  return { definitions, relations, diagnostics }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
