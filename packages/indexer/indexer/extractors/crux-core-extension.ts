import type { IndexerExtension } from '../extensions'
import { cruxIndexLintRule } from '../index-lint-extension'
import { relationSpecFromPolicy } from '../extensions'
import { indexRelationPolicies } from '../relation-registry'
import { agentIndexExtractor } from './agent-extension'
import { compositionIndexExtractor } from './composition-extension'
import { contextIndexExtractor } from './context-extension'
import { evalIndexExtractor } from './eval-extension'
import { flowIndexExtractor } from './flow-extension'
import { blackboardIndexExtractor, memoryIndexExtractor } from './memory-extension'
import { injectableIndexExtractor } from './injectable-extension'
import { promptIndexExtractor } from './prompt-extension'
import { ragRetrieverIndexExtractor } from './rag-extension'
import { routingIndexExtractor } from './routing-extension'
import { safetyIndexExtractor } from './safety-extension'
import { scorerIndexExtractor } from './scorer-extension'
import { toolIndexExtractor } from './tool-extension'
import { workspaceIndexExtractor } from './workspace-extension'

/**
 * First-party extension manifest for Crux-authored index primitives.
 *
 * This is the production registry entry that proves the extension boundary can host existing internal
 * indexer behavior. It contributes relation specs from the built-in relation registry and owns
 * all first-party static extractor patterns.
 */
export const cruxCoreExtension: IndexerExtension = {
  name: '@crux/indexer/crux-core',
  version: '1',
  crux: {
    indexer: '^0.1.0',
    projectIndexSchema: 1,
  },
  extractors: [
    ragRetrieverIndexExtractor,
    safetyIndexExtractor,
    scorerIndexExtractor,
    workspaceIndexExtractor,
    evalIndexExtractor,
    toolIndexExtractor,
    injectableIndexExtractor,
    contextIndexExtractor,
    promptIndexExtractor,
    agentIndexExtractor,
    compositionIndexExtractor,
    memoryIndexExtractor,
    blackboardIndexExtractor,
    routingIndexExtractor,
    flowIndexExtractor,
  ],
  rules: [cruxIndexLintRule],
  relations: indexRelationPolicies.map(relationSpecFromPolicy),
}
