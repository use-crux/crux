import type { ProjectCatalogSnapshot } from '@crux/core/catalog'
import { createCatalogGraphBuilder, graphSources } from './graph/builder'
import type { CatalogSourceRefFact } from './patches'

/**
 * Builds source rows that make semantic source-ref support files durable graph evidence.
 */
export function semanticSupportSources(
  previousCatalog: ProjectCatalogSnapshot | undefined,
  sourceRefs: readonly CatalogSourceRefFact[] | undefined,
): ProjectCatalogSnapshot['sources'] {
  if (!previousCatalog || !sourceRefs?.length) return []
  const graphBuilder = createCatalogGraphBuilder()
  for (const fact of sourceRefs) {
    const ownerFile = ownerFileForDefinition(previousCatalog, fact.definitionId)
    if (!ownerFile) continue
    graphBuilder.addDependency(ownerFile, fact.ref.source.file)
  }
  return graphSources(graphBuilder.graph)
}

function ownerFileForDefinition(previousCatalog: ProjectCatalogSnapshot, definitionId: string): string | undefined {
  return (
    previousCatalog.definitions.find((definition) => definition.id === definitionId)?.source?.file ??
    previousCatalog.sources.find((source) => source.definitionIds?.includes(definitionId))?.file
  )
}
