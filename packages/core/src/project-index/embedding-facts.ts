/**
 * Project Index facts for authored embedding models, calls, and indexers.
 *
 * These contracts contain only statically knowable, byte-safe descriptors.
 * Embedding inputs, media locators, provider-side asset identifiers, and full
 * fingerprints are intentionally absent.
 *
 * @module
 */

import type { ProjectIndexMediaModality } from "./index";

/** Allowlisted runtime-fingerprint inputs proven from authored configuration. */
export interface EmbeddingIdentityInputs {
  /** Authored embedding or resolved model name. */
  readonly name?: string;
  /** Provider/model version when it contributes to vector semantics. */
  readonly version?: string;
  /** Dense vector dimensions. */
  readonly dimensions?: number;
  /** Maximum accepted input-token count. */
  readonly maxInputTokens?: number;
  /** Deterministic truncation behavior. */
  readonly truncate?:
    | { readonly strategy: "fail" }
    | { readonly strategy: "chars"; readonly maxChars: number };
  /** Declared or model-inferred input modalities. */
  readonly modalities?: readonly ProjectIndexMediaModality[];
  /** Dense vector normalization semantics. */
  readonly normalization?: "unit" | "none" | "unknown";
  /** Provider task identifiers that distinguish query/document vectors. */
  readonly tasks?: { readonly query?: string; readonly document?: string };
  /** Count of preprocessors; their potentially sensitive fingerprints are omitted. */
  readonly preprocessorCount?: number;
}

/** Safe dense vector-space descriptor projected for catalog presentation. */
export interface EmbeddingSpaceFacts {
  /** Embedding model or authored space name. */
  readonly name: string;
  /** Number of scalar values in each dense vector. */
  readonly dimensions: number;
  /** Full SHA-256 identity digest when every runtime fingerprint input is proven. */
  readonly digest?: string;
}

/** Static facts for an authored dense or sparse embedding definition. */
export interface EmbeddingFacts {
  readonly kind: "embedding";
  /** Vector representation produced by the embedding. */
  readonly embeddingKind: "dense" | "sparse";
  /** Closed first-party adapter identity when import provenance proves it. */
  readonly adapter?: "core" | "google" | "openai" | "ai-sdk";
  /** Provider model id when it is a literal. */
  readonly model?: string;
  /** Allowlisted vector-semantic inputs known at compile time. */
  readonly identityInputs?: EmbeddingIdentityInputs;
  /** Full SHA-256 of the exact runtime fingerprint when fully proven. */
  readonly identityDigest?: string;
  /** Dense-only vector-space presentation facts. */
  readonly space?: EmbeddingSpaceFacts;
}

/** Static facts for a direct authored embedding invocation. */
export interface EmbeddingCallFacts {
  readonly kind: "embedding.call";
  /** Invoked batch shape. */
  readonly operation: "embed" | "embedMany";
  /** Input modalities conclusively proven at this callsite. */
  readonly modalities?: readonly ProjectIndexMediaModality[];
  /** Query/document role when authored as a literal. */
  readonly role?: "query" | "document";
}

/** Static facts for an authored vector indexer definition. */
export interface RagIndexerFacts {
  readonly kind: "rag.indexer";
  /** Stable indexer id when authored as a literal. */
  readonly indexerId?: string;
  /** Vector namespace when authored as a literal. */
  readonly namespace?: string;
}
