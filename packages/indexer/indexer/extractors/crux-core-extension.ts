import type { IndexerExtension } from "../extensions";
import { relationSpecFromPolicy } from "../extensions";
import { indexRelationPolicies } from "../relations";
import { agentIndexExtractor } from "./agent-extension";
import { compositionIndexExtractor } from "./composition-extension";
import { contextIndexExtractor } from "./context-extension";
import { evalIndexExtractor } from "./eval-extension";
import { flowIndexExtractor } from "./flow-extension";
import {
  blackboardIndexExtractor,
  memoryIndexExtractor,
} from "./memory-extension";
import { injectableIndexExtractor } from "./injectable-extension";
import { promptIndexExtractor } from "./prompt-extension";
import { ragRetrieverIndexExtractor } from "./rag-extension";
import { routingIndexExtractor } from "./routing-extension";
import { runtimeTaskIndexExtractor } from "./runtime-task-extension";
import { safetyIndexExtractor } from "./safety-extension";
import { scorerIndexExtractor } from "./scorer-extension";
import {
  registryIndexExtractor,
  registrySkillIndexExtractor,
} from "./skill-registry-extension";
import { storageIndexExtractor } from "./storage-extension";
import { toolIndexExtractor } from "./tool-extension";
import { workspaceIndexExtractor } from "./workspace-extension";

/**
 * First-party extension manifest for Crux-authored index primitives.
 *
 * This is the production registry entry that proves the extension boundary can host existing internal
 * indexer behavior. It contributes relation specs from the built-in relation registry and owns
 * all first-party static extractor patterns.
 */
export const cruxCoreExtension: IndexerExtension = {
  name: "@use-crux/indexer/crux-core",
  version: "2",
  crux: {
    indexer: "^0.1.0",
    projectIndexSchema: 1,
  },
  static: {
    evidence: { mode: "declared" },
  },
  extractors: [
    ragRetrieverIndexExtractor,
    safetyIndexExtractor,
    scorerIndexExtractor,
    storageIndexExtractor,
    workspaceIndexExtractor,
    evalIndexExtractor,
    registryIndexExtractor,
    registrySkillIndexExtractor,
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
    runtimeTaskIndexExtractor,
  ],
  relations: indexRelationPolicies.map(relationSpecFromPolicy),
};
