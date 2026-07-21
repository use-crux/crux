import type {
  IndexLintFinding,
  ProjectDefinition,
  ProjectRelation,
  ProjectSourceRef,
} from "@use-crux/core/project-index";
import { projectRelation } from "../relations";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerSourceFile,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  propertyInitializer,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import { semanticSourceForNode } from "../semantic/syntax-readers";
import {
  modalityFindings,
  namespaceIdentityFindings,
  sparseEmbeddingFinding,
} from "./semantic-lints";
import { semanticConsumerCallFindings } from "./semantic-consumer-calls";
import { semanticConsumerDefinition } from "./semantic-consumer-facts";
import {
  semanticEmbeddingConsumerForCall,
  semanticEmbeddingForExpression,
  type SemanticEmbeddingConsumer,
  type SemanticEmbeddingDescriptor,
} from "./semantic-model";
import {
  embeddingCallFacts,
  semanticDescendants,
  semanticInputModalities,
  sourceLocationId,
  stringProperty,
} from "./semantic-values";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

export interface SemanticEmbeddingFactsResult {
  readonly definitions: readonly ProjectDefinition[];
  readonly sourceRefs: readonly {
    readonly definitionId: string;
    readonly ref: ProjectSourceRef;
  }[];
  readonly relations: readonly ProjectRelation[];
  readonly lintFindings: readonly IndexLintFinding[];
}

/** Project embedding callsites, consumer dependencies, and conclusive lints. */
export function semanticEmbeddingFacts(
  root: string,
  sourceFiles: readonly SemanticAnalyzerSourceFile<SemanticAnalyzerView>[],
  view: SemanticAnalyzerView,
): SemanticEmbeddingFactsResult {
  const definitions: ProjectDefinition[] = [];
  const sourceRefs: { definitionId: string; ref: ProjectSourceRef }[] = [];
  const relations: ProjectRelation[] = [];
  const lintFindings: IndexLintFinding[] = [];
  const calls = semanticDescendants(sourceFiles, view).filter((node) =>
    view.syntax.isKind(node, "callExpression"),
  );
  const consumers = calls.flatMap((call) => {
    const consumer = semanticEmbeddingConsumerForCall(root, call, view);
    return consumer ? [consumer] : [];
  });

  for (const consumer of consumers) {
    definitions.push(semanticConsumerDefinition(consumer, view));
    appendConsumerRelations(consumer, relations, view);
    appendUnresolvedConsumerRefs(consumer, sourceRefs, view);
  }
  lintFindings.push(...namespaceIdentityFindings(consumers, view));

  for (const call of calls) {
    const operation = embeddingOperation(call, view);
    if (operation) {
      const receiver = callReceiver(call, view);
      const embedding = receiver
        ? semanticEmbeddingForExpression(root, receiver, view)
        : undefined;
      if (embedding) {
        const args = view.syntax.callArguments(call);
        const modalities = semanticInputModalities(args[0], view);
        const role = roleForOptions(args[1], view);
        const id = `embedding.call:${sourceLocationId(root, call, view)}`;
        definitions.push({
          id,
          kind: "embedding.call",
          name: operation,
          source: semanticSourceForNode(call, view.syntax),
          fidelity: "resolved",
          status: "active",
          metadata: { facts: embeddingCallFacts(operation, modalities, role) },
        });
        relations.push(
          projectRelation({
            type: "embedding.call.uses_embedding",
            from: id,
            to: embedding.id,
            fidelity: "resolved",
            source: semanticSourceForNode(receiver!, view.syntax),
          }),
        );
        lintFindings.push(
          ...modalityFindings(id, embedding, modalities, args[0] ?? call, view),
        );
      } else if (receiver && hasEmbeddingType(receiver, view)) {
        const args = view.syntax.callArguments(call);
        const id = `embedding.call:${sourceLocationId(root, call, view)}`;
        definitions.push({
          id,
          kind: "embedding.call",
          name: operation,
          source: semanticSourceForNode(call, view.syntax),
          fidelity: "partial",
          status: "active",
          metadata: {
            facts: embeddingCallFacts(
              operation,
              semanticInputModalities(args[0], view),
              roleForOptions(args[1], view),
            ),
          },
        });
        sourceRefs.push(partialEmbeddingRef(id, "receiver", receiver, view));
      }
    }

    lintFindings.push(...semanticConsumerCallFindings(root, call, view));
  }

  for (const embedding of authoredEmbeddings(root, calls, view)) {
    const finding = sparseEmbeddingFinding(embedding, view);
    if (finding) lintFindings.push(finding);
  }

  return {
    definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
    sourceRefs: sourceRefs.sort((a, b) => a.ref.id.localeCompare(b.ref.id)),
    relations: dedupe(relations).sort((a, b) => a.id.localeCompare(b.id)),
    lintFindings: dedupe(lintFindings).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function appendUnresolvedConsumerRefs(
  consumer: SemanticEmbeddingConsumer,
  sourceRefs: { definitionId: string; ref: ProjectSourceRef }[],
  view: SemanticAnalyzerView,
): void {
  for (const [property, embedding] of consumer.kind === "rag.knowledgeBase"
    ? ([
        ["embeddings", consumer.dense],
        ["sparseEmbeddings", consumer.sparse],
      ] as const)
    : ([
        ["dense", consumer.dense],
        ["sparse", consumer.sparse],
      ] as const)) {
    const expression = propertyInitializer(consumer.config, property, view);
    if (expression && !embedding) {
      sourceRefs.push(
        partialEmbeddingRef(consumer.id, property, expression, view),
      );
    }
  }
}

function partialEmbeddingRef(
  definitionId: string,
  property: string,
  expression: Node,
  view: SemanticAnalyzerView,
): { readonly definitionId: string; readonly ref: ProjectSourceRef } {
  const source = semanticSourceForNode(expression, view.syntax);
  return {
    definitionId,
    ref: {
      id: `${definitionId}:source:config:${property}:${source.line}:${source.column}`,
      role: "config",
      property,
      source,
      fidelity: "partial",
      description: "Embedding reference could not be resolved statically.",
    },
  };
}

function hasEmbeddingType(
  expression: Node,
  view: SemanticAnalyzerView,
): boolean {
  const type = view.typesAt([expression])[0];
  if (!type) return false;
  const display = view.typeStrings([type], expression)[0] ?? "";
  return /\b(?:Dense|Sparse)Embedding(?:<|\b)/.test(display);
}

function appendConsumerRelations(
  consumer: SemanticEmbeddingConsumer,
  relations: ProjectRelation[],
  view: SemanticAnalyzerView,
): void {
  for (const [embedding, kind] of [
    [consumer.dense, "dense"],
    [consumer.sparse, "sparse"],
  ] as const) {
    if (!embedding) continue;
    const property =
      consumer.kind === "rag.knowledgeBase"
        ? kind === "dense"
          ? "embeddings"
          : "sparseEmbeddings"
        : kind;
    const expression = propertyInitializer(consumer.config, property, view);
    relations.push(
      projectRelation({
        type: `${consumer.kind}.uses_${kind}_embedding`,
        from: consumer.id,
        to: embedding.id,
        fidelity: "resolved",
        source: semanticSourceForNode(expression ?? consumer.call, view.syntax),
      }),
    );
  }
}

function embeddingOperation(
  call: Node,
  view: SemanticAnalyzerView,
): "embed" | "embedMany" | undefined {
  const name = view.syntax.callExpressionName(call);
  return name === "embed" || name === "embedMany" ? name : undefined;
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

function roleForOptions(
  expression: Node | undefined,
  view: SemanticAnalyzerView,
): "query" | "document" | undefined {
  if (!expression) return undefined;
  const object = semanticObjectExpression(expression, view, new Set());
  const role = object ? stringProperty(object, "role", view) : undefined;
  return role === "query" || role === "document" ? role : undefined;
}

function authoredEmbeddings(
  root: string,
  calls: readonly Node[],
  view: SemanticAnalyzerView,
): readonly SemanticEmbeddingDescriptor[] {
  return calls.flatMap((call) => {
    const target = view.syntax.callExpressionTarget(call);
    const embedding = target
      ? semanticEmbeddingForExpression(root, call, view)
      : undefined;
    return embedding ? [embedding] : [];
  });
}

function dedupe<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}
