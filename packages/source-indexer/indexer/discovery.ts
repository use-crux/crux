import { readFile } from 'node:fs/promises'
import type {
  CatalogDiagnostic,
  CatalogSourceFile,
  ProjectDefinition,
  ProjectIdentity,
  ProjectRelation,
  PromptMeta,
} from '@crux/core/catalog'
import type { LoadedProjectConfig } from './config'
import { foldedCatalogChild } from './catalog-presentation'
import { definition, relation, safeId } from './definitions'
import { suiteJsonInvalidDiagnostic, suiteJsonReadFailedDiagnostic } from './diagnostics'
import { discoverRuntimeEvalDefinitions } from './eval-discovery'
import { isPortableSuiteJson } from './evaluations'
import { evalGlobs, suiteJsonFiles } from './files'
import { discoverResolvedDefinitionsFromStaticCandidates, discoverStaticDefinitions } from './static-discovery'
import { sourceStatus } from './sources'
import type { SourceGraph, StaticFactParser } from './types'

export interface ProjectDiscoveryResult {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
  readonly sourceGraph: SourceGraph
}

export interface ProjectDiscoveryInput {
  readonly root: string
  readonly loaded: LoadedProjectConfig
  readonly project: ProjectIdentity
  readonly initialFacts: {
    readonly prompts: readonly PromptMeta[]
    readonly definitions: readonly ProjectDefinition[]
    readonly relations: readonly ProjectRelation[]
  }
  readonly diagnostics: readonly CatalogDiagnostic[]
  readonly sources: readonly CatalogSourceFile[]
  readonly staticFiles: readonly string[]
  readonly parser: StaticFactParser
}

export async function discoverProjectDefinitions(input: ProjectDiscoveryInput): Promise<ProjectDiscoveryResult> {
  const { root, loaded, initialFacts, staticFiles, parser } = input
  const diagnostics: CatalogDiagnostic[] = [...input.diagnostics]
  let sources = input.sources
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const localDiagnostics: CatalogDiagnostic[] = []
  const sourceGraph: SourceGraph = { dependenciesByFile: new Map() }
  const promptIds = new Set(
    initialFacts.prompts.map((prompt) => prompt.id).filter((id): id is string => typeof id === 'string'),
  )

  const failedImportFiles: string[] = []
  if (!loaded.staticOnly) {
    const evalResult = await discoverRuntimeEvalDefinitions(root, evalGlobs(loaded), promptIds, sources)
    definitions.push(...evalResult.definitions)
    relations.push(...evalResult.relations)
    diagnostics.push(...evalResult.diagnostics)
    failedImportFiles.push(...evalResult.failedImportFiles)
    sources = evalResult.sources

    const resolvedRich = await discoverResolvedDefinitionsFromStaticCandidates(root, sources, staticFiles, parser)
    definitions.push(...resolvedRich.definitions)
    relations.push(...resolvedRich.relations)
    diagnostics.push(...resolvedRich.diagnostics)
    failedImportFiles.push(...resolvedRich.failedImportFiles)
    sources = resolvedRich.sources
    mergeSourceGraph(sourceGraph, resolvedRich.sourceGraph)
  }

  const knownDefinitionIds = new Set([
    ...initialFacts.definitions.map((definitionItem) => definitionItem.id),
    ...definitions.map((definitionItem) => definitionItem.id),
  ])
  const staticResult = await discoverStaticDefinitions(
    root,
    loaded,
    { definitions: initialFacts.definitions, relations: initialFacts.relations },
    failedImportFiles,
    sources,
    knownDefinitionIds,
    staticFiles,
    parser,
  )
  definitions.push(...staticResult.definitions)
  relations.push(...staticResult.relations)
  localDiagnostics.push(...staticResult.diagnostics)
  sources = staticResult.sources
  mergeSourceGraph(sourceGraph, staticResult.sourceGraph)

  const suiteResult = await discoverSuiteJsonDefinitions(root, loaded, sources)
  definitions.push(...suiteResult.definitions)
  relations.push(...suiteResult.relations)
  localDiagnostics.push(...suiteResult.diagnostics)
  sources = suiteResult.sources

  return {
    definitions,
    relations,
    diagnostics: [...diagnostics, ...localDiagnostics],
    sources,
    sourceGraph,
  }
}

function mergeSourceGraph(target: SourceGraph, incoming: SourceGraph): void {
  for (const [file, dependencies] of incoming.dependenciesByFile) {
    target.dependenciesByFile.set(
      file,
      [...new Set([...(target.dependenciesByFile.get(file) ?? []), ...dependencies])].sort(),
    )
  }
}

async function discoverSuiteJsonDefinitions(
  root: string,
  loaded: LoadedProjectConfig,
  sources: readonly CatalogSourceFile[],
): Promise<{
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  sources: readonly CatalogSourceFile[]
}> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const diagnostics: CatalogDiagnostic[] = []
  let nextSources = sources

  for (const jsonFile of suiteJsonFiles(root, loaded)) {
    nextSources = sourceStatus(nextSources, jsonFile, 'indexed')
    try {
      const raw = await readFile(jsonFile, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!isPortableSuiteJson(parsed)) {
        diagnostics.push(suiteJsonInvalidDiagnostic(jsonFile))
        nextSources = sourceStatus(nextSources, jsonFile, 'partial')
        continue
      }
      const suiteId = `suite:${safeId(parsed.id)}`
      definitions.push(
        await definition(root, jsonFile, suiteId, 'suite', parsed.id, parsed.description, {
          source: 'json',
          caseCount: parsed.cases.length,
          facts: {
            kind: 'suite',
            caseCount: parsed.cases.length,
          },
        }),
      )
      for (const [index, testCase] of parsed.cases.entries()) {
        const caseId = `suite.case:${safeId(parsed.id)}:${safeId(testCase.id)}`
        definitions.push(
          await definition(root, jsonFile, caseId, 'suite.case', testCase.name ?? testCase.id, undefined, {
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
          }),
        )
        relations.push(relation('suite.includes_case', suiteId, caseId, jsonFile))
      }
    } catch (error) {
      diagnostics.push(suiteJsonReadFailedDiagnostic(jsonFile, errorMessage(error)))
      nextSources = sourceStatus(nextSources, jsonFile, 'error')
    }
  }

  return { definitions, relations, diagnostics, sources: nextSources }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
