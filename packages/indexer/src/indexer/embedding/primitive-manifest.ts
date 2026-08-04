import type {
  EmbeddingFacts,
  RagIndexerFacts,
} from "@use-crux/core/project-index";
import {
  facts,
  none,
  type ExtractContext,
  type IndexerExtension,
} from "../extensions";
import { coreEmbeddingIdentity } from "./fingerprint";
import {
  authoredEmbeddingPrimitiveManifest,
  embeddingFactoryDeclarations,
  embeddingRelationDeclarations,
  indexerFactoryModules,
} from "./manifest";
import { providerEmbeddingFacts } from "./provider-facts";
import { byteSafeEmbeddingDefinition } from "./safe-definition";
import { extractEmbeddingCall } from "./static-call";
import { evidenceRecordPrimitiveContributions } from "../evidence-record/primitive-manifest";
import { knowledgePrimitiveContributions } from "../knowledge/primitive-manifest";
import { threadPrimitiveContributions } from "../thread/primitive-manifest";
import { sessionPrimitiveContributions } from "../session/primitive-manifest";
import { signalPrimitiveContributions } from "../signal/primitive-manifest";

export { authoredEmbeddingPrimitiveManifest } from "./manifest";

/** Immutable first-party embedding and vector-indexer primitive manifest. */
export const embeddingPrimitiveManifest = Object.freeze({
  name: "@use-crux/indexer/crux-core",
  version: "2",
  extractors: [
    ...evidenceRecordPrimitiveContributions.extractors,
    ...knowledgePrimitiveContributions.extractors,
    ...threadPrimitiveContributions.extractors,
    ...sessionPrimitiveContributions.extractors,
    ...signalPrimitiveContributions.extractors,
    {
      name: "embedding",
      patterns: embeddingFactoryDeclarations.map((factory) => ({
        kind: "call" as const,
        name: factory.call,
        importFrom: [factory.module],
        configArg: factory.configArg,
      })),
      extract: extractEmbedding,
    },
    {
      name: "rag.indexer",
      patterns: [
        {
          kind: "call" as const,
          name: "indexer",
          importFrom: indexerFactoryModules,
          configArg: 0,
        },
      ],
      extract: extractRagIndexer,
    },
    {
      name: "embedding.call",
      patterns: [
        { kind: "call" as const, name: "embed" },
        { kind: "call" as const, name: "embedMany" },
      ],
      extract: extractEmbeddingCall,
    },
  ],
  relations: [
    ...embeddingRelationDeclarations.map((type) => ({
      type,
      fromKinds: relationKinds(type).from,
      toKinds: ["embedding"] as const,
      presentation: "both" as const,
      fidelity: "resolved" as const,
      runtimeJoin: false,
    })),
    ...evidenceRecordPrimitiveContributions.relations,
    ...sessionPrimitiveContributions.relations,
    ...signalPrimitiveContributions.relations,
  ],
} satisfies IndexerExtension);

function extractEmbedding(ctx: ExtractContext) {
  const factory = embeddingFactoryDeclarations.find(
    (candidate) => candidate.module === ctx.match.moduleSpecifier,
  );
  const config =
    ctx.config ?? (factory ? ctx.args.object(factory.configArg) : undefined);
  if (!config || !factory) return none();

  const embeddingKind =
    factory.adapter === "core" ? config.string("kind") : "dense";
  if (embeddingKind !== "dense" && embeddingKind !== "sparse") return none();
  const identity =
    factory.adapter === "core"
      ? coreEmbeddingIdentity(config, embeddingKind)
      : undefined;
  const factsValue: EmbeddingFacts = {
    kind: "embedding",
    embeddingKind,
    adapter: factory.adapter,
    ...(identity && Object.keys(identity.inputs).length
      ? { identityInputs: identity.inputs }
      : {}),
    ...(identity?.digest ? { identityDigest: identity.digest } : {}),
    ...(identity?.space ? { space: identity.space } : {}),
    ...(factory.adapter === "core"
      ? {}
      : providerEmbeddingFacts(config, factory.adapter)),
  };
  const definitionId = `embedding:${ctx.source.safeId(ctx.source.localName)}`;
  return facts({
    definitions: [
      byteSafeEmbeddingDefinition(
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id: definitionId,
          kind: "embedding",
          name: ctx.source.variableName,
          metadata: {
            ...(ctx.source.exported
              ? { exportName: ctx.source.variableName }
              : {}),
            facts: factsValue,
          },
        }),
      ),
    ],
  });
}

function extractRagIndexer(ctx: ExtractContext) {
  const config = ctx.config;
  if (!config) return none();
  const indexerId = config.string("id");
  const namespace = config.string("namespace");
  const definitionId = `rag.indexer:${ctx.source.safeId(indexerId ?? ctx.source.localName)}`;
  const factsValue: RagIndexerFacts = {
    kind: "rag.indexer",
    ...(indexerId ? { indexerId } : {}),
    ...(namespace ? { namespace } : {}),
  };
  const dense = config.reference("dense");
  const sparse = config.reference("sparse");
  const references = [
    ...(dense
      ? [ctx.ref.variable("rag.indexer.uses_dense_embedding", dense)]
      : []),
    ...(sparse
      ? [ctx.ref.variable("rag.indexer.uses_sparse_embedding", sparse)]
      : []),
  ];
  return facts({
    definitions: [
      byteSafeEmbeddingDefinition(
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id: definitionId,
          kind: "rag.indexer",
          name: indexerId ?? ctx.source.variableName,
          metadata: {
            ...(ctx.source.exported
              ? { exportName: ctx.source.variableName }
              : {}),
            facts: factsValue,
          },
        }),
      ),
    ],
    ...(references.length ? { references } : {}),
  });
}

function relationKinds(type: (typeof embeddingRelationDeclarations)[number]): {
  readonly from: readonly (
    | "embedding.call"
    | "rag.indexer"
    | "rag.retriever"
    | "rag.knowledgeBase"
  )[];
} {
  if (type.startsWith("embedding.call.")) return { from: ["embedding.call"] };
  if (type.startsWith("rag.indexer.")) return { from: ["rag.indexer"] };
  if (type.startsWith("rag.retriever.")) return { from: ["rag.retriever"] };
  return { from: ["rag.knowledgeBase"] };
}
