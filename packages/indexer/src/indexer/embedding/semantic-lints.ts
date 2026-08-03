import type {
  IndexLintFinding,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import type {
  SemanticAnalyzerNode,
  SemanticAnalyzerView,
} from "../semantic/candidates";
import {
  propertyInitializer,
  semanticArrayExpression,
  semanticObjectExpression,
} from "../semantic/model/object-readers";
import { semanticSourceForNode } from "../semantic/syntax-readers";
import type {
  SemanticEmbeddingConsumer,
  SemanticEmbeddingDescriptor,
} from "./semantic-model";
import { mediaTypeModality, stringProperty } from "./semantic-values";

type Node = SemanticAnalyzerNode<SemanticAnalyzerView>;

/** Reports exact namespace collisions only when storage and both identity digests are proven. */
export function namespaceIdentityFindings(
  consumers: readonly SemanticEmbeddingConsumer[],
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const findings: IndexLintFinding[] = [];
  for (let leftIndex = 0; leftIndex < consumers.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < consumers.length;
      rightIndex += 1
    ) {
      const left = consumers[leftIndex]!;
      const right = consumers[rightIndex]!;
      if (
        !left.namespace ||
        left.namespace !== right.namespace ||
        !sharesWriteReadBoundary(left, right) ||
        !left.searchStorageKey ||
        left.searchStorageKey !== right.searchStorageKey ||
        !hasIdentityMismatch(left, right)
      ) {
        continue;
      }
      findings.push(
        embeddingFinding({
          ruleId: "embedding.namespace-identity-mismatch",
          definitionId: right.id,
          relatedDefinitionIds: [left.id],
          sourceNode:
            propertyInitializer(right.config, "namespace", view) ?? right.call,
          message: `Namespace "${right.namespace}" uses different embedding identities with the same vector storage.`,
          view,
        }),
      );
    }
  }
  return findings;
}

function sharesWriteReadBoundary(
  left: SemanticEmbeddingConsumer,
  right: SemanticEmbeddingConsumer,
): boolean {
  const writes = (consumer: SemanticEmbeddingConsumer): boolean =>
    consumer.kind !== "rag.retriever";
  const reads = (consumer: SemanticEmbeddingConsumer): boolean =>
    consumer.kind !== "rag.indexer";
  return (writes(left) && reads(right)) || (writes(right) && reads(left));
}

function hasIdentityMismatch(
  left: SemanticEmbeddingConsumer,
  right: SemanticEmbeddingConsumer,
): boolean {
  return (["dense", "sparse"] as const).some((kind) => {
    const leftDigest = left[kind]?.identityDigest;
    const rightDigest = right[kind]?.identityDigest;
    return Boolean(leftDigest && rightDigest && leftDigest !== rightDigest);
  });
}

/** Reports media input that a proven embedding cannot represent. */
export function modalityFindings(
  definitionId: string,
  embedding: SemanticEmbeddingDescriptor,
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  sourceNode: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  const media = modalities?.filter((item) => item !== "text") ?? [];
  if (media.length === 0) return [];
  if (embedding.kind === "sparse") {
    return [
      embeddingFinding({
        ruleId: "embedding.sparse-media",
        definitionId,
        relatedDefinitionIds: [embedding.id],
        sourceNode,
        message: "Sparse embedding calls cannot accept media input.",
        view,
      }),
    ];
  }
  const declaredModalities = embedding.modalities;
  if (!declaredModalities) return [];
  const unsupported = media.filter(
    (modality) => !declaredModalities.includes(modality),
  );
  return unsupported.length
    ? [
        embeddingFinding({
          ruleId: "embedding.unsupported-modality",
          definitionId,
          relatedDefinitionIds: [embedding.id],
          sourceNode,
          message: `Embedding does not declare ${unsupported.join(", ")} input.`,
          view,
        }),
      ]
    : [];
}

/** Applies modality checks to the active dense/sparse branch of a retriever. */
export function consumerModalityFindings(
  consumer: SemanticEmbeddingConsumer,
  modalities: readonly ProjectIndexMediaModality[] | undefined,
  sourceNode: Node,
  view: SemanticAnalyzerView,
): readonly IndexLintFinding[] {
  if (!modalities?.some((item) => item !== "text")) return [];
  if (consumer.mode === "sparse" && consumer.sparse) {
    return modalityFindings(
      consumer.id,
      consumer.sparse,
      modalities,
      sourceNode,
      view,
    );
  }
  if (
    (consumer.mode === "dense" || consumer.mode === "hybrid") &&
    consumer.dense
  ) {
    return modalityFindings(
      consumer.id,
      consumer.dense,
      modalities,
      sourceNode,
      view,
    );
  }
  return [];
}

/** Reports media evidence sent to a sparse-only indexing consumer. */
export function sparseMediaIndexingFinding(
  consumer: SemanticEmbeddingConsumer | undefined,
  input: Node | undefined,
  call: Node,
  view: SemanticAnalyzerView,
): IndexLintFinding | undefined {
  return consumer?.mode === "sparse" && containsMediaEvidence(input, view)
    ? embeddingFinding({
        ruleId: "embedding.sparse-media",
        definitionId: consumer.id,
        sourceNode: input ?? call,
        message: "A sparse-only indexer cannot make media chunks searchable.",
        view,
      })
    : undefined;
}

/** Collects literal media-part modalities from nested document or chunk input. */
export function mediaModalitiesIn(
  root: Node | undefined,
  view: SemanticAnalyzerView,
): readonly ProjectIndexMediaModality[] | undefined {
  if (!root) return undefined;
  const modalities = new Set<ProjectIndexMediaModality>();
  const seen = new Set<Node>();
  const visit = (node: Node): void => {
    const unwrapped = view.syntax.unwrapExpression(node);
    if (seen.has(unwrapped)) return;
    seen.add(unwrapped);
    const array = semanticArrayExpression(unwrapped, view, new Set());
    if (array) {
      view.syntax.arrayElements(array).forEach(visit);
      return;
    }
    const object = semanticObjectExpression(unwrapped, view, new Set());
    const type = object ? stringProperty(object, "type", view) : undefined;
    const mediaType = object
      ? stringProperty(object, "mediaType", view)
      : undefined;
    if (type === "file") modalities.add("document");
    else if (type && type !== "text" && isMediaModality(type)) {
      modalities.add(type);
    }
    const inferred = mediaTypeModality(mediaType);
    if (inferred) modalities.add(inferred);
    if (!object) return;
    for (const property of [
      "asset",
      "chunks",
      "document",
      "documents",
      "media",
      "parts",
    ]) {
      const child = propertyInitializer(object, property, view);
      if (child) visit(child);
    }
  };
  visit(root);
  return modalities.size > 0 ? [...modalities] : undefined;
}

/** Reports a sparse embedding definition that explicitly declares media modalities. */
export function sparseEmbeddingFinding(
  embedding: SemanticEmbeddingDescriptor,
  view: SemanticAnalyzerView,
): IndexLintFinding | undefined {
  const media = embedding.modalities?.filter((item) => item !== "text") ?? [];
  return embedding.kind === "sparse" && media.length > 0
    ? embeddingFinding({
        ruleId: "embedding.sparse-media",
        definitionId: embedding.id,
        sourceNode:
          propertyInitializer(embedding.config, "modalities", view) ??
          embedding.call,
        message: "Sparse embeddings support text only.",
        view,
      })
    : undefined;
}

function containsMediaEvidence(
  root: Node | undefined,
  view: SemanticAnalyzerView,
): boolean {
  return Boolean(mediaModalitiesIn(root, view)?.length);
}

function isMediaModality(
  value: string,
): value is Exclude<ProjectIndexMediaModality, "text"> {
  return ["image", "audio", "video", "document"].includes(value);
}

function embeddingFinding(input: {
  readonly ruleId:
    | "embedding.unsupported-modality"
    | "embedding.namespace-identity-mismatch"
    | "embedding.sparse-media";
  readonly definitionId: string;
  readonly relatedDefinitionIds?: readonly string[];
  readonly sourceNode: Node;
  readonly message: string;
  readonly view: SemanticAnalyzerView;
}): IndexLintFinding {
  const source = semanticSourceForNode(input.sourceNode, input.view.syntax);
  return {
    id: `${input.ruleId}:${input.definitionId}:${source.line}:${source.column}`,
    ruleId: input.ruleId,
    severity: "error",
    category: "contracts",
    maturity: "experimental",
    confidence: "high",
    profiles: ["recommended", "strict"],
    title: input.ruleId,
    message: input.message,
    rationale:
      "The compiler proved this combination from resolved authored source.",
    impact:
      "The authored embedding configuration cannot produce compatible searchable vectors.",
    source,
    primaryDefinitionId: input.definitionId,
    relatedDefinitionIds: [...(input.relatedDefinitionIds ?? [])],
    evidence: [
      {
        kind: "source",
        label: "Resolved embedding evidence",
        source,
        data: { source: "semantic", fidelity: "resolved" },
      },
    ],
    fixes: [
      {
        title: "Align embedding capabilities and vector space",
        description: "Use a compatible embedding or a distinct namespace.",
        kind: "manual",
      },
    ],
    docsUrl: `/docs/reference/crux-core/index-lints/${input.ruleId.replaceAll(".", "-")}`,
  };
}
