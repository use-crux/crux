import type { EmbeddingFacts } from "@use-crux/core/project-index";

/** Declarative factory surface for first-party embedding adapters. */
export const embeddingFactoryDeclarations = Object.freeze([
  Object.freeze({
    module: "@use-crux/core",
    call: "embedding",
    configArg: 0,
    adapter: "core",
  }),
  Object.freeze({
    module: "@use-crux/core/embedding",
    call: "embedding",
    configArg: 0,
    adapter: "core",
  }),
  Object.freeze({
    module: "@use-crux/google",
    call: "embedding",
    configArg: 1,
    adapter: "google",
  }),
  Object.freeze({
    module: "@use-crux/openai",
    call: "embedding",
    configArg: 1,
    adapter: "openai",
  }),
  Object.freeze({
    module: "@use-crux/ai",
    call: "embedding",
    configArg: 0,
    adapter: "ai-sdk",
  }),
] as const satisfies readonly {
  readonly module: string;
  readonly call: "embedding";
  readonly configArg: number;
  readonly adapter: NonNullable<EmbeddingFacts["adapter"]>;
}[]);

/** Public module entry points that export the Core vector indexer factory. */
export const indexerFactoryModules = Object.freeze([
  "@use-crux/core/indexing",
  "@use-crux/core",
] as const);

/** Consumer-to-embedding relation vocabulary owned by the compiler profile. */
export const embeddingRelationDeclarations = Object.freeze([
  "embedding.call.uses_embedding",
  "rag.indexer.uses_dense_embedding",
  "rag.indexer.uses_sparse_embedding",
  "rag.retriever.uses_dense_embedding",
  "rag.retriever.uses_sparse_embedding",
  "rag.knowledgeBase.uses_dense_embedding",
  "rag.knowledgeBase.uses_sparse_embedding",
] as const);

/** SDK-verified Google defaults mirrored from the adapter's package-private map. */
export const googleEmbeddingDefaults = Object.freeze({
  "gemini-embedding-2": Object.freeze({
    modalities: Object.freeze([
      "text",
      "image",
      "audio",
      "video",
      "document",
    ] as const),
    dimensions: 3072,
    maxInputTokens: 8192,
  }),
  "gemini-embedding-001": Object.freeze({ modalities: ["text"] as const }),
  "text-embedding-004": Object.freeze({ modalities: ["text"] as const }),
});

/** OpenAI output dimensions inferred by the runtime adapter. */
export const openAIEmbeddingDimensions = Object.freeze({
  "text-embedding-ada-002": 1536,
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
});

/**
 * Data-only first-party declaration shared by static and semantic projection.
 *
 * It intentionally contains no provider SDK objects or executable callbacks.
 */
export const authoredEmbeddingPrimitiveManifest = Object.freeze({
  version: 1,
  factories: embeddingFactoryDeclarations,
  definitions: Object.freeze([
    Object.freeze({
      kind: "embedding",
      identity: "module-scoped-binding",
      fields: Object.freeze([
        "embeddingKind",
        "adapter",
        "model",
        "identityInputs",
        "identityDigest",
        "space",
      ]),
    }),
    Object.freeze({
      kind: "embedding.call",
      identity: "source-location",
      fields: Object.freeze(["operation", "modalities", "role"]),
    }),
    Object.freeze({
      kind: "rag.indexer",
      identity: "literal-id-or-module-scoped-binding",
      fields: Object.freeze(["indexerId", "namespace"]),
    }),
  ]),
  relations: embeddingRelationDeclarations,
  nativeProjection: Object.freeze({
    static: Object.freeze({ frontend: "oxc", mode: "manifest" }),
    semantic: Object.freeze({ backend: "tsgo", mode: "shared-analyzer" }),
  }),
});
