import type {
  MediaOperationAuthoredOptions,
  MediaOperationFacts,
} from "@use-crux/core/project-index";

export const mediaOperationNames = [
  "generate",
  "stream",
  "generateImage",
  "transcribe",
  "generateSpeech",
  "describe",
] as const satisfies readonly MediaOperationFacts["operation"][];

export const mediaAuthoredOptionFields = [
  "n",
  "size",
  "aspectRatio",
  "seed",
  "timestamps",
  "diarization",
  "taskType",
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

export const mediaRelationDeclarations = [
  ["media.owner", "owner"],
  ["media.uses_prompt", "prompt"],
  ["media.uses_routing", "routing"],
  ["media.derives_with", "derivation"],
  ["media.targets_index", "index"],
  ["media.targets_corpus", "corpus"],
  ["media.evaluation_target", "evaluation"],
  ["media.uses_storage", "storage"],
] as const;

/** Data-only first-party declaration shared by static and native projection lanes. */
export const authoredMediaPrimitiveManifest = Object.freeze({
  version: 2,
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
      sourceRefRoles: Object.freeze({ model: "config", options: "config" }),
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
});
