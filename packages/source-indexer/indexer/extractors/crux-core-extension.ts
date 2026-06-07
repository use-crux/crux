import type { SourceIndexerExtension } from '../extensions'
import { cruxCatalogLintRule } from '../catalog-lint-extension'
import { relationSpecFromPolicy } from '../extensions'
import { catalogRelationPolicies } from '../relation-registry'
import { agentCatalogExtractor } from './agent-extension'
import { compositionCatalogExtractor } from './composition-extension'
import { contextCatalogExtractor } from './context-extension'
import { evalCatalogExtractor } from './eval-extension'
import { flowCatalogExtractor } from './flow-extension'
import { blackboardCatalogExtractor, memoryCatalogExtractor } from './memory-extension'
import { injectableCatalogExtractor } from './injectable-extension'
import { promptCatalogExtractor } from './prompt-extension'
import { ragRetrieverCatalogExtractor } from './rag-extension'
import { routingCatalogExtractor } from './routing-extension'
import { safetyCatalogExtractor } from './safety-extension'
import { scorerCatalogExtractor } from './scorer-extension'
import { toolCatalogExtractor } from './tool-extension'
import { workspaceCatalogExtractor } from './workspace-extension'

/**
 * First-party extension manifest for Crux-authored catalog primitives.
 *
 * This is the production registry entry that proves the extension boundary can host existing internal
 * source-indexer behavior. It contributes relation specs from the built-in relation registry and owns
 * all first-party static extractor patterns.
 */
export const cruxCoreExtension: SourceIndexerExtension = {
  name: '@crux/source-indexer/crux-core',
  version: '1',
  extractors: [
    ragRetrieverCatalogExtractor,
    safetyCatalogExtractor,
    scorerCatalogExtractor,
    workspaceCatalogExtractor,
    evalCatalogExtractor,
    toolCatalogExtractor,
    injectableCatalogExtractor,
    contextCatalogExtractor,
    promptCatalogExtractor,
    agentCatalogExtractor,
    compositionCatalogExtractor,
    memoryCatalogExtractor,
    blackboardCatalogExtractor,
    routingCatalogExtractor,
    flowCatalogExtractor,
  ],
  rules: [cruxCatalogLintRule],
  relations: catalogRelationPolicies.map(relationSpecFromPolicy),
}
