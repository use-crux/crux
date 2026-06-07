import type { SourceIndexerExtension } from '../extensions'
import { legacyCatalogExtractor, relationSpecFromPolicy } from '../extensions'
import { catalogRelationPolicies } from '../relation-registry'
import { agentExtractor } from './agent'
import { compositionExtractor } from './composition'
import { contextExtractor } from './context'
import { evalExtractor } from './eval'
import { flowExtractor } from './flow'
import { blackboardExtractor, memoryExtractor } from './memory'
import { promptExtractor } from './prompt'
import { ragExtractor } from './rag'
import { routingExtractor } from './routing'
import { safetyExtractor } from './safety'
import { scorerExtractor } from './scorer'
import { toolExtractor } from './tool'
import { workspaceExtractor } from './workspace'

const legacyPrimitiveExtractors = [
  workspaceExtractor,
  memoryExtractor,
  blackboardExtractor,
  promptExtractor,
  contextExtractor,
  toolExtractor,
  agentExtractor,
  flowExtractor,
  routingExtractor,
  ragExtractor,
  safetyExtractor,
  scorerExtractor,
  evalExtractor,
  compositionExtractor,
]

export const cruxCoreExtension: SourceIndexerExtension = {
  name: '@crux/source-indexer/crux-core',
  version: '1',
  extractors: legacyPrimitiveExtractors.map(legacyCatalogExtractor),
  relations: catalogRelationPolicies.map(relationSpecFromPolicy),
}
