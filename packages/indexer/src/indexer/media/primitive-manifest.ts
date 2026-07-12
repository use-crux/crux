import type {
  IngestSourceFacts,
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
  ProjectIndexMediaModality,
} from "@use-crux/core/project-index";
import {
  facts,
  none,
  type ExtractContext,
  type IndexerExtension,
} from "../extensions";
import {
  ingestSourceCallKinds,
  mediaOperationNames,
  mediaRelationDeclarations,
} from "./manifest";
export {
  authoredMediaPrimitiveManifest,
  mediaAuthoredOptionFields,
  mediaOperationNames,
} from "./manifest";

const routingKinds = [
  "routing.router",
  "routing.split",
  "routing.retry",
  "routing.cascade",
  "routing.fallback",
] as const;

const evaluationKinds = [
  "evaluation",
  "eval.prompt",
  "eval.flow",
  "eval.rag",
  "eval.quality",
] as const;

/** Immutable first-party authored-media primitive manifest. */
export const mediaPrimitiveManifest: IndexerExtension = Object.freeze({
  name: "@use-crux/indexer/crux-core-media",
  version: "1",
  extractors: [
    {
      name: "media.operation",
      patterns: mediaOperationNames.map((name) => ({
        kind: "call" as const,
        name,
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
    relation("media.evaluation_target", ["media.operation"], evaluationKinds),
    relation("media.uses_storage", ["media.operation"], ["storage.assetStore"]),
  ],
});

function extractMediaOperation(ctx: ExtractContext) {
  const operation = mediaOperationNames.find((name) => name === ctx.match.name);
  if (!operation) return none();
  const provenInput = mediaModalities(ctx.config?.json());
  if (
    (operation === "generate" || operation === "stream") &&
    provenInput.length === 0
  )
    return none();

  const definitionId = `media.operation:${ctx.source.safeId(ctx.source.variableName)}`;
  const factsValue: MediaOperationFacts = {
    kind: "media.operation",
    operation,
    ...operationModalities(operation, provenInput),
    ...literalIdentity(ctx),
    execution: literalExecution(ctx) ?? "unknown",
    ...authoredOptions(ctx),
  };
  const references = relationReferences(ctx);
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

function mediaModalities(value: unknown): readonly ProjectIndexMediaModality[] {
  const found = new Set<ProjectIndexMediaModality>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, nested] of Object.entries(candidate)) {
      if ((key === "type" || key === "kind") && typeof nested === "string") {
        const modality = nested === "file" ? "document" : nested;
        if (
          mediaModalityOrder.includes(modality as ProjectIndexMediaModality)
        ) {
          found.add(modality as ProjectIndexMediaModality);
        }
      }
      visit(nested);
    }
  };
  visit(value);
  return mediaModalityOrder.filter((item) => found.has(item));
}

function operationModalities(
  operation: MediaOperationFacts["operation"],
  provenInput: readonly ProjectIndexMediaModality[],
): Pick<MediaOperationFacts, "inputModalities" | "outputModalities"> {
  switch (operation) {
    case "generateImage":
      return { outputModalities: ["image"] };
    case "transcribe":
      return { inputModalities: ["audio"], outputModalities: ["text"] };
    case "generateSpeech":
      return { inputModalities: ["text"], outputModalities: ["audio"] };
    case "describe":
      return {
        ...(provenInput.length ? { inputModalities: provenInput } : {}),
        outputModalities: ["text"],
      };
    case "generate":
    case "stream":
      return { inputModalities: provenInput, outputModalities: ["text"] };
  }
}

function literalIdentity(
  ctx: ExtractContext,
): Pick<MediaOperationFacts, "adapter" | "model"> {
  const adapter = ctx.config?.string("adapter");
  const model = ctx.config?.string("model");
  return { ...(adapter ? { adapter } : {}), ...(model ? { model } : {}) };
}

function literalExecution(
  ctx: ExtractContext,
): MediaOperationFacts["execution"] | undefined {
  const value = ctx.config?.string("execution");
  return value === "native" || value === "composed" || value === "unknown"
    ? value
    : undefined;
}

function authoredOptions(
  ctx: ExtractContext,
): Pick<MediaOperationFacts, "authoredOptions"> {
  const config = ctx.config;
  if (!config) return {};
  const options: MediaOperationAuthoredOptions = {
    ...optionalNumber("n", config.number("n")),
    ...optionalString("size", config.string("size")),
    ...optionalString("aspectRatio", config.string("aspectRatio")),
    ...optionalNumber("seed", config.number("seed")),
    ...optionalString("timestamps", config.string("timestamps")),
    ...(config.boolean("diarization") === undefined
      ? {}
      : { diarization: config.boolean("diarization") }),
    ...optionalString("taskType", config.string("taskType")),
    ...optionalString("voice", config.string("voice")),
  };
  return Object.keys(options).length ? { authoredOptions: options } : {};
}

function relationReferences(ctx: ExtractContext) {
  return mediaRelationDeclarations.flatMap(([type, property]) => {
    const target =
      property === "owner"
        ? ctx.source.ownerVariableName
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

function optionalString<K extends keyof MediaOperationAuthoredOptions>(
  key: K,
  value: string | undefined,
) {
  return value === undefined ? {} : { [key]: value };
}

function optionalNumber<K extends keyof MediaOperationAuthoredOptions>(
  key: K,
  value: number | undefined,
) {
  return value === undefined ? {} : { [key]: value };
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
