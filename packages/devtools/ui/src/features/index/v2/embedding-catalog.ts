/**
 * Byte-safe Project Index projections for embedding consumer cards.
 *
 * The projector accepts only resolved consumer-to-embedding dependencies and
 * rebuilds a closed view. Arbitrary facts and embedding inputs never cross the
 * Catalog boundary.
 *
 * @module
 */

import { mediaModalityList, type MediaModality } from "./media-catalog";

/** Dense vector-space identity presented on a consumer card. */
export interface EmbeddingCatalogSpace {
  readonly name: string;
  readonly dimensions: number;
  readonly digest?: string;
}

/** One embedding dependency resolved from a consumer relation. */
export interface EmbeddingCatalogDependency {
  readonly id: string;
  readonly name: string;
  readonly embeddingKind: "dense" | "sparse";
  readonly modalities: readonly MediaModality[];
  readonly space?: EmbeddingCatalogSpace;
}

/** Closed Catalog view for a retriever or knowledge base. */
export interface EmbeddingConsumerCatalogView {
  readonly kind: "embedding.consumer";
  readonly id: string;
  readonly name: string;
  readonly consumerKind: "rag.retriever" | "rag.knowledgeBase";
  readonly embeddings: readonly EmbeddingCatalogDependency[];
}

/** Project resolved embedding dependencies into a byte-safe consumer view. */
export function projectEmbeddingConsumerCatalog(input: {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly dependencies: readonly {
    readonly relationType: string;
    readonly id: string;
    readonly name: string;
    readonly facts?: unknown;
  }[];
}): EmbeddingConsumerCatalogView | undefined {
  if (input.kind !== "rag.retriever" && input.kind !== "rag.knowledgeBase") {
    return undefined;
  }
  const embeddings = input.dependencies.flatMap((dependency) => {
    const facts = asRecord(dependency.facts);
    if (facts?.kind !== "embedding") return [];
    const embeddingKind = relationEmbeddingKind(dependency.relationType);
    if (!embeddingKind) return [];
    const identityInputs = asRecord(facts.identityInputs);
    const space = embeddingKind === "dense" ? projectSpace(facts.space) : undefined;
    return [
      Object.freeze({
        id: dependency.id,
        name: dependency.name,
        embeddingKind,
        modalities: mediaModalityList(identityInputs?.modalities),
        ...(space ? { space } : {}),
      }),
    ];
  });
  if (embeddings.length === 0) return undefined;
  return Object.freeze({
    kind: "embedding.consumer",
    id: input.id,
    name: input.name,
    consumerKind: input.kind,
    embeddings: Object.freeze(embeddings),
  });
}

/** Return the stable twelve-character digest form used by Catalog cards. */
export function shortEmbeddingDigest(digest: string): string {
  return `${digest.slice(0, 12)}…`;
}

function relationEmbeddingKind(
  relationType: string,
): "dense" | "sparse" | undefined {
  if (relationType.endsWith(".uses_dense_embedding")) return "dense";
  if (relationType.endsWith(".uses_sparse_embedding")) return "sparse";
  return undefined;
}

function projectSpace(value: unknown): EmbeddingCatalogSpace | undefined {
  const space = asRecord(value);
  const name = stringValue(space?.name);
  const dimensions = numberValue(space?.dimensions);
  if (!name || dimensions === undefined) return undefined;
  const digest = digestValue(space?.digest);
  return Object.freeze({ name, dimensions, ...(digest ? { digest } : {}) });
}

function digestValue(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
