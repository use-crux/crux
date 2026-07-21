import type {
  ProjectDefinition,
  RagFacts,
  RagIndexerFacts,
} from "@use-crux/core/project-index";
import type { SemanticAnalyzerView } from "../semantic/candidates";
import { semanticSourceForNode } from "../semantic/syntax-readers";
import type { SemanticEmbeddingConsumer } from "./semantic-model";

/** Builds the resolved, byte-safe fact patch for an embedding consumer. */
export function semanticConsumerDefinition(
  consumer: SemanticEmbeddingConsumer,
  view: SemanticAnalyzerView,
): ProjectDefinition {
  return {
    id: consumer.id,
    kind: consumer.kind,
    name: consumer.authoredId ?? consumer.binding,
    source: semanticSourceForNode(consumer.call, view.syntax),
    fidelity: "resolved",
    status: "active",
    metadata: { facts: consumerFacts(consumer) },
  };
}

function consumerFacts(
  consumer: SemanticEmbeddingConsumer,
): RagFacts | RagIndexerFacts {
  if (consumer.kind === "rag.indexer") {
    return {
      kind: "rag.indexer",
      ...(consumer.indexerId ? { indexerId: consumer.indexerId } : {}),
      ...(consumer.namespace ? { namespace: consumer.namespace } : {}),
    };
  }
  if (consumer.kind === "rag.retriever") {
    return {
      kind: "rag.retriever",
      retrieverId: consumer.authoredId ?? consumer.binding,
      ...(consumer.indexerId ? { indexerId: consumer.indexerId } : {}),
      ...(consumer.namespace ? { namespace: consumer.namespace } : {}),
    };
  }
  return {
    kind: "rag.knowledgeBase",
    knowledgeBaseId: consumer.authoredId ?? consumer.binding,
    ...(consumer.indexerId ? { indexerId: consumer.indexerId } : {}),
    ...(consumer.namespace ? { namespace: consumer.namespace } : {}),
  };
}
