import type { IndexLintFinding } from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  propertyInitializer,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import { resolveSemanticExpression } from "../semantic/model/source-refs";
import {
  consumerModalityFindings,
  mediaModalitiesIn,
  sparseMediaIndexingFinding,
} from "./semantic-lints";
import {
  semanticEmbeddingConsumerForCall,
  type SemanticEmbeddingConsumer,
} from "./semantic-model";
import { semanticInputModalities, stringProperty } from "./semantic-values";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/** Reports conclusive modality errors at retrieval and indexing boundaries. */
export function semanticConsumerCallFindings(
  root: string,
  call: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const method = view.syntax.callExpressionName(call);
  if (method === "knowledgeBase") {
    return configuredKnowledgeBaseFindings(root, call, view);
  }
  const receiver = callReceiver(call, view);
  const consumer = receiver
    ? consumerForExpression(root, receiver, view)
    : undefined;
  if (!consumer) return [];

  const input = view.syntax.callArguments(call)[0];
  if (method === "retrieve") {
    return retrievalFindings(consumer, call, view);
  }
  if (
    method === "indexDocuments" ||
    method === "indexChunks" ||
    method === "index" ||
    method === "reindex"
  ) {
    return indexingFindings(consumer, input, call, view);
  }
  return [];
}

function retrievalFindings(
  consumer: SemanticEmbeddingConsumer,
  call: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const args = view.syntax.callArguments(call);
  const request = args[0]
    ? semanticObjectExpression(args[0], view, new Set())
    : undefined;
  const requestInput = request
    ? propertyInitializer(request, "input", view)
    : undefined;
  const options =
    !requestInput && args[1]
      ? semanticObjectExpression(args[1], view, new Set())
      : undefined;
  const mode = modeOverride(requestInput ? request : options, view);
  const active = mode ? { ...consumer, mode } : consumer;
  const input = requestInput ?? args[0];
  return consumerModalityFindings(
    active,
    semanticInputModalities(input, view),
    input ?? call,
    view,
  );
}

function configuredKnowledgeBaseFindings(
  root: string,
  call: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const consumer = semanticEmbeddingConsumerForCall(root, call, view);
  const source = consumer
    ? propertyInitializer(consumer.config, "source", view)
    : undefined;
  return consumer && source
    ? indexingFindings(consumer, source, call, view)
    : [];
}

function indexingFindings(
  consumer: SemanticEmbeddingConsumer,
  input: Node | undefined,
  call: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const sparse = sparseMediaIndexingFinding(consumer, input, call, view);
  return sparse
    ? [sparse]
    : consumerModalityFindings(
        consumer,
        mediaModalitiesIn(input, view),
        input ?? call,
        view,
      );
}

function consumerForExpression(
  root: string,
  expression: Node,
  view: SemanticAnalyzerView,
  seen = new Set<Node>(),
): SemanticEmbeddingConsumer | undefined {
  const unwrapped = view.syntax.unwrapExpression(expression);
  if (seen.has(unwrapped)) return undefined;
  const nextSeen = new Set(seen).add(unwrapped);
  if (view.syntax.isKind(unwrapped, "callExpression")) {
    const direct = semanticEmbeddingConsumerForCall(root, unwrapped, view);
    if (direct) return direct;
    if (view.syntax.callExpressionName(unwrapped) === "retriever") {
      const receiver = callReceiver(unwrapped, view);
      const knowledgeBase = receiver
        ? consumerForExpression(root, receiver, view, nextSeen)
        : undefined;
      if (knowledgeBase?.kind === "rag.knowledgeBase") {
        return withRetrieverMode(knowledgeBase, unwrapped, view);
      }
    }
    return undefined;
  }
  const resolved = resolveSemanticExpression(unwrapped, view);
  return resolved?.expression
    ? consumerForExpression(root, resolved.expression, view, nextSeen)
    : undefined;
}

function withRetrieverMode(
  consumer: SemanticEmbeddingConsumer,
  call: Node,
  view: SemanticAnalyzerView,
): SemanticEmbeddingConsumer {
  const options = view.syntax.callArguments(call)[0];
  const config = options
    ? semanticObjectExpression(options, view, new Set())
    : undefined;
  const mode = modeOverride(config, view);
  return mode ? { ...consumer, mode } : consumer;
}

function modeOverride(
  config: Node | undefined,
  view: SemanticAnalyzerView,
): SemanticEmbeddingConsumer["mode"] | undefined {
  if (!config || !propertyInitializer(config, "mode", view)) return undefined;
  const mode = stringProperty(config, "mode", view);
  return mode === "dense" || mode === "sparse" || mode === "hybrid"
    ? mode
    : "unknown";
}

function callReceiver(
  call: Node,
  view: SemanticAnalyzerView,
): Node | undefined {
  const target = view.syntax.callExpressionTarget(call);
  return target && view.syntax.isKind(target, "propertyAccessExpression")
    ? view.syntax.propertyAccessExpression(target)
    : undefined;
}
