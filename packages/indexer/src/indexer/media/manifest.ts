import type {
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
} from "@use-crux/core/project-index";

export const mediaOperationNames = [
  "generate",
  "stream",
  "generateImage",
  "streamImage",
  "transcribe",
  "generateSpeech",
  "streamSpeech",
  "describe",
] as const satisfies readonly MediaOperationFacts["operation"][];

/** Positional config argument for each public media operation. */
export const mediaOperationConfigArguments = Object.freeze({
  generate: 1,
  stream: 1,
  generateImage: 0,
  streamImage: 0,
  transcribe: 0,
  generateSpeech: 0,
  streamSpeech: 0,
  describe: 0,
} as const satisfies Readonly<
  Record<MediaOperationFacts["operation"], number>
>);

export const mediaAuthoredOptionFields = [
  "n",
  "size",
  "aspectRatio",
  "seed",
  "timestamps",
  "diarization",
  "task",
  "voice",
] as const satisfies readonly (keyof MediaOperationAuthoredOptions)[];

export const ingestSourceCallKinds = {
  fileSource: "file",
  filesSource: "file",
  urlSource: "url",
  urlsSource: "url",
  textSource: "custom",
} as const;

/** Conclusive first-party capability exclusions consumed by semantic linting. */
export const mediaUnsupportedCapabilities = Object.freeze([
  Object.freeze({
    adapter: "anthropic",
    operations: Object.freeze(["generateImage"] as const),
  }),
]);

/** Provider operations whose public adapter shape proves native execution. */
export const mediaNativeCapabilities = Object.freeze([
  Object.freeze({
    adapter: "openai",
    operations: Object.freeze(["streamImage", "streamSpeech"] as const),
  }),
  Object.freeze({
    adapter: "google",
    operations: Object.freeze(["streamImage", "streamSpeech"] as const),
  }),
]);

/** Resolve compiler-proven native media support without inspecting payloads. */
export function nativeMediaExecution(
  adapter: string | undefined,
  operation: MediaOperationFacts["operation"],
): MediaOperationFacts["execution"] | undefined {
  return mediaNativeCapabilities.some(
    (capability) =>
      capability.adapter === adapter &&
      capability.operations.some((candidate) => candidate === operation),
  )
    ? "native"
    : undefined;
}

export const mediaRelationDeclarations = [
  ["media.owner", "owner"],
  ["media.uses_prompt", "prompt"],
  ["media.uses_routing", "routing"],
  ["media.derives_with", "derivation"],
  ["media.targets_index", "index"],
  ["media.targets_corpus", "corpus"],
  ["media.eval_target", "eval"],
  ["media.uses_storage", "storage"],
] as const;

/** Data-only first-party declaration shared by static and native projection lanes. */
export const authoredMediaPrimitiveManifest = Object.freeze({
  version: 4,
  definitions: Object.freeze([
    Object.freeze({
      kind: "media.operation",
      calls: mediaOperationNames,
      identity: "binding-or-callsite",
      fields: Object.freeze([
        "operation",
        "inputModalities",
        "outputModalities",
        "adapter",
        "model",
        "execution",
        "authoredOptions",
      ]),
      authoredOptions: mediaAuthoredOptionFields,
      sourceRefRoles: Object.freeze({
        model: "config",
        options: "config",
        safety: "config",
      }),
    }),
    Object.freeze({
      kind: "ingest.source",
      calls: Object.freeze(Object.keys(ingestSourceCallKinds)),
      identity: "binding-or-callsite",
      fields: Object.freeze([
        "sourceKind",
        "mediaKinds",
        "namespace",
        "attribution",
      ]),
      sourceRefRoles: Object.freeze({ source: "config", derivation: "config" }),
    }),
  ]),
  relations: mediaRelationDeclarations,
  nativeProjection: Object.freeze({
    static: Object.freeze({ frontend: "oxc", mode: "manifest" }),
    semantic: Object.freeze({ backend: "tsgo", mode: "shared-analyzer" }),
  }),
  unsupportedCapabilities: mediaUnsupportedCapabilities,
  nativeCapabilities: mediaNativeCapabilities,
});
