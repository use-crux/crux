import type { IngestSourceFacts } from "@use-crux/core/project-index";
import {
  facts,
  none,
  type ExtractContext,
  type IndexerExtension,
} from "../extensions";
import {
  ingestSourceCallKinds,
  mediaOperationConfigArguments,
  mediaOperationNames,
  mediaRelationDeclarations,
} from "./manifest";
import { mediaOperationFacts } from "./operation-facts";
import {
  operationPolicyReferences,
  operationSafetySourceRefs,
} from "./operation-safety-references";
export {
  authoredMediaPrimitiveManifest,
  mediaAuthoredOptionFields,
  mediaOperationConfigArguments,
  mediaOperationNames,
} from "./manifest";

const routingKinds = [
  "routing.router",
  "routing.split",
  "routing.retry",
  "routing.cascade",
  "routing.fallback",
] as const;

const evaluationKinds = ["eval"] as const;

/** Immutable first-party authored-media primitive manifest. */
export const mediaPrimitiveManifest: IndexerExtension = Object.freeze({
  name: "@use-crux/indexer/crux-core-media",
  version: "4",
  extractors: [
    {
      name: "media.operation",
      patterns: mediaOperationNames.map((name) => ({
        kind: "call" as const,
        name,
        configArg: mediaOperationConfigArguments[name],
      })),
      extract: extractMediaOperation,
    },
    {
      name: "ingest.source",
      patterns: Object.keys(ingestSourceCallKinds).map((name) => ({
        kind: "call" as const,
        name,
        configArg: 1,
      })),
      extract: extractIngestSource,
    },
  ],
  relations: [
    relation("media.owner", ["media.operation"], []),
    relation("media.uses_prompt", ["media.operation"], ["prompt"]),
    relation("media.uses_routing", ["media.operation"], routingKinds),
    relation("media.derives_with", ["ingest.source"], ["media.operation"]),
    relation(
      "media.targets_index",
      ["ingest.source"],
      ["rag.knowledgeBase", "rag.pipeline"],
    ),
    relation("media.targets_corpus", ["ingest.source"], ["rag.knowledgeBase"]),
    relation("media.eval_target", ["media.operation"], evaluationKinds),
    relation("media.uses_storage", ["media.operation"], ["storage.assetStore"]),
  ],
});

function extractMediaOperation(ctx: ExtractContext) {
  const factsValue = mediaOperationFacts(ctx);
  if (!factsValue) return none();
  const definitionId = `media.operation:${ctx.source.safeId(ctx.source.variableName)}`;
  const references = relationReferences(ctx);
  references.push(...operationPolicyReferences(ctx, definitionId));
  const sourceRefs = operationSafetySourceRefs(ctx, definitionId);
  return facts({
    definitions: [
      sanitizedDefinition(
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id: definitionId,
          kind: "media.operation",
          name: ctx.source.variableName,
          metadata: {
            ...(ctx.source.exported
              ? { exportName: ctx.source.variableName }
              : {}),
            facts: factsValue,
            indexPresentation: presentation(ctx),
          },
        }),
      ),
    ],
    ...(references.length ? { references } : {}),
    ...(sourceRefs.length ? { sourceRefs } : {}),
  });
}

function extractIngestSource(ctx: ExtractContext) {
  const declaredKind =
    ingestSourceCallKinds[ctx.match.name as keyof typeof ingestSourceCallKinds];
  if (!declaredKind) return none();
  const sourceKind = ingestSourceKind(ctx, declaredKind);
  const mediaKinds = allowedValues(
    ctx.config?.stringArray("mediaKinds") ?? [],
    mediaModalityOrder,
  );
  const attribution = allowedValues(
    ctx.config?.stringArray("attribution") ?? [],
    ["page", "time"] as const,
  );
  const factsValue: IngestSourceFacts = {
    kind: "ingest.source",
    sourceKind,
    ...(mediaKinds.length ? { mediaKinds } : {}),
    ...(ctx.config?.string("namespace")
      ? { namespace: ctx.config.string("namespace") }
      : {}),
    ...(attribution.length ? { attribution } : {}),
  };
  const definitionId = `ingest.source:${ctx.source.safeId(ctx.source.variableName)}`;
  const references = relationReferences(ctx);
  return facts({
    definitions: [
      sanitizedDefinition(
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id: definitionId,
          kind: "ingest.source",
          name: ctx.source.variableName,
          metadata: {
            ...(ctx.source.exported
              ? { exportName: ctx.source.variableName }
              : {}),
            facts: factsValue,
            indexPresentation: presentation(ctx),
          },
        }),
      ),
    ],
    ...(references.length ? { references } : {}),
  });
}

const mediaModalityOrder = [
  "text",
  "image",
  "audio",
  "video",
  "document",
] as const;

function relationReferences(ctx: ExtractContext) {
  return mediaRelationDeclarations.flatMap(([type, property]) => {
    const target =
      type === "media.owner"
        ? ctx.source.ownerVariableName
        : type === "media.uses_prompt"
          ? ctx.match.name === "generate" || ctx.match.name === "stream"
            ? ctx.args.identifier(0)
            : undefined
          : type === "media.uses_routing"
            ? ctx.config?.reference("model")
            : ctx.config?.reference(property);
    return target ? [ctx.ref.variable(type, target)] : [];
  });
}

function presentation(ctx: ExtractContext) {
  const nested = new RegExp(`^${ctx.match.name}-\\d+$`).test(
    ctx.source.variableName,
  );
  return nested
    ? { standalone: false, role: "operation" as const }
    : { standalone: true };
}

function ingestSourceKind(
  ctx: ExtractContext,
  declared: IngestSourceFacts["sourceKind"],
): IngestSourceFacts["sourceKind"] {
  if (declared !== "file") return declared;
  if (ctx.args.string(0) !== undefined) return "file";
  const value = ctx.args.json(0);
  if (Array.isArray(value) && value.every((item) => typeof item === "string"))
    return "file";
  if (value && typeof value === "object") return "asset";
  return "custom";
}

function allowedValues<const T extends string>(
  values: readonly string[],
  allowed: readonly T[],
): readonly T[] {
  const set = new Set(values);
  return allowed.filter((value) => set.has(value));
}

function relation(
  type: string,
  fromKinds: readonly string[],
  toKinds: readonly string[],
) {
  return {
    type,
    fromKinds,
    toKinds,
    presentation: "both" as const,
    fidelity: "resolved" as const,
    runtimeJoin: false,
  };
}

function sanitizedDefinition<
  T extends ReturnType<ExtractContext["define"]["definition"]>,
>(input: T): T {
  const { sourceSnippet: _sourceSnippet, ...definition } = input.definition;
  return { ...input, definition } as T;
}
