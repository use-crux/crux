import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { createIndexGraphBuilder, graphSources } from './graph/builder'
import type { IndexSourceRefFact } from './patches'

/**
 * Builds source rows that make semantic source-ref support files durable graph evidence.
 */
export function semanticSupportSources(
  previousIndex: ProjectIndexSnapshot | undefined,
  sourceRefs: readonly IndexSourceRefFact[] | undefined,
): ProjectIndexSnapshot['sources'] {
  if (!previousIndex || !sourceRefs?.length) return []
  const graphBuilder = createIndexGraphBuilder()
  for (const fact of sourceRefs) {
    const ownerFile = ownerFileForDefinition(previousIndex, fact.definitionId)
    if (!ownerFile) continue
    graphBuilder.addDependency(ownerFile, fact.ref.source.file)
  }
  return graphSources(graphBuilder.graph)
}

function ownerFileForDefinition(previousIndex: ProjectIndexSnapshot, definitionId: string): string | undefined {
  return (
    previousIndex.definitions.find((definition) => definition.id === definitionId)?.source?.file ??
    previousIndex.sources.find((source) => source.definitionIds?.includes(definitionId))?.file
  )
}
