import type { CatalogDiagnostic, CatalogSourceFile, ProjectDefinition, ProjectRelation } from '@crux/core/catalog'
import type { LoadedProjectConfig } from './config'
import { richImportFailedDiagnostic, staticParseFailedDiagnostic } from './diagnostics'
import { resolvedDefinitionFromExport } from './enrichment'
import { importUserModule, withCruxIndexMode } from './imports'
import { mapBounded } from './pipeline'
import { parseStaticDefinitionsFromFactsCached } from './static-cache'
import { staticFactParser } from './static-parser'
import { sourceStatus } from './sources'
import type { SourceGraph, StaticFactParser, StaticParseResult } from './types'

export interface RichStaticDiscoveryResult {
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  failedImportFiles: string[]
  diagnostics: CatalogDiagnostic[]
  sources: readonly CatalogSourceFile[]
  sourceGraph: SourceGraph
}

export async function discoverResolvedDefinitionsFromStaticCandidates(
  root: string,
  sources: readonly CatalogSourceFile[],
  staticFiles: readonly string[],
  parser: StaticFactParser = staticFactParser,
): Promise<RichStaticDiscoveryResult> {
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const failedImportFiles: string[] = []
  const diagnostics: CatalogDiagnostic[] = []
  let nextSources = sources
  const dependenciesByFile = new Map<string, string[]>()

  for (const file of staticFiles) {
    let parsed: StaticParseResult
    try {
      parsed = await parseStaticDefinitionsFromFactsCached(root, file, parser)
    } catch {
      continue
    }
    dependenciesByFile.set(file, parsed.dependencies)
    diagnostics.push(...parsed.diagnostics)
    if (parsed.definitions.length === 0) continue

    const expectedByExport = new Map<string, ProjectDefinition>()
    for (const definitionItem of parsed.definitions) {
      if (definitionItem.kind === 'flow.step') continue
      const exportName =
        typeof definitionItem.metadata?.exportName === 'string' ? definitionItem.metadata.exportName : undefined
      if (exportName) expectedByExport.set(exportName, definitionItem)
    }
    if (expectedByExport.size === 0) continue

    nextSources = sourceStatus(nextSources, file, 'indexed')
    await withCruxIndexMode(async () => {
      try {
        const mod = await importUserModule(file, 4_000)
        const moduleDefinitions: ProjectDefinition[] = []
        const moduleRelations: ProjectRelation[] = []
        for (const [exportName, value] of Object.entries(mod)) {
          const expected = expectedByExport.get(exportName)
          if (!expected) continue
          const resolved = await resolvedDefinitionFromExport(root, file, exportName, value, expected)
          if (!resolved) continue
          moduleDefinitions.push(resolved.definition)
          moduleRelations.push(...resolved.relations)
        }
        definitions.push(...moduleDefinitions)
        relations.push(...moduleRelations)
      } catch (error) {
        failedImportFiles.push(file)
        nextSources = sourceStatus(nextSources, file, 'error')
        diagnostics.push(richImportFailedDiagnostic(root, file, errorMessage(error)))
      }
    })
  }

  return {
    definitions,
    relations,
    failedImportFiles,
    diagnostics,
    sources: nextSources,
    sourceGraph: { dependenciesByFile },
  }
}

export async function discoverStaticDefinitions(
  root: string,
  loaded: LoadedProjectConfig,
  catalogFacts: {
    readonly definitions: readonly ProjectDefinition[]
    readonly relations: readonly ProjectRelation[]
  },
  failedImportFiles: string[],
  sources: readonly CatalogSourceFile[],
  knownDefinitionIds = new Set(catalogFacts.definitions.map((definition) => definition.id)),
  staticFiles: readonly string[] = [],
  parser: StaticFactParser = staticFactParser,
): Promise<{
  definitions: ProjectDefinition[]
  relations: ProjectRelation[]
  diagnostics: CatalogDiagnostic[]
  sources: readonly CatalogSourceFile[]
  sourceGraph: SourceGraph
}> {
  const files = new Set<string>()
  if (loaded.configFile) files.add(loaded.configFile)
  for (const file of failedImportFiles) files.add(file)
  for (const file of staticFiles) {
    files.add(file)
  }

  const existingIds = new Set(knownDefinitionIds)
  const definitions: ProjectDefinition[] = []
  const relations: ProjectRelation[] = []
  const diagnostics: CatalogDiagnostic[] = []
  let nextSources = sources
  const dependenciesByFile = new Map<string, string[]>()

  const parsedFiles = await mapBounded([...files].sort(), 8, async (file) => {
    try {
      return { file, parsed: await parseStaticDefinitionsFromFactsCached(root, file, parser) } as const
    } catch (error) {
      return { file, error } as const
    }
  })

  for (const result of parsedFiles) {
    const file = result.file
    if ('error' in result) {
      nextSources = sourceStatus(nextSources, file, 'error')
      diagnostics.push(staticParseFailedDiagnostic(root, file, errorMessage(result.error)))
      continue
    }
    const parsed = result.parsed
    dependenciesByFile.set(file, parsed.dependencies)
    diagnostics.push(...parsed.diagnostics)

    if (parsed.definitions.length === 0 && parsed.relations.length === 0) continue

    const isFallback = failedImportFiles.includes(file) || Boolean(loaded.configFile === file && loaded.importFailed)
    nextSources = sourceStatus(nextSources, file, isFallback ? 'partial' : 'indexed')

    for (const definition of parsed.definitions) {
      if (!existingIds.has(definition.id)) {
        existingIds.add(definition.id)
      }
      definitions.push(definition)
    }
    const relationIds = new Set([
      ...catalogFacts.relations.map((relationItem) => relationItem.id),
      ...relations.map((relationItem) => relationItem.id),
    ])
    for (const relationItem of parsed.relations) {
      if (relationIds.has(relationItem.id)) continue
      relationIds.add(relationItem.id)
      relations.push(relationItem)
    }
  }

  return { definitions, relations, diagnostics, sources: nextSources, sourceGraph: { dependenciesByFile } }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
