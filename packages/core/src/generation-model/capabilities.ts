import type { z } from "zod";
import type { AnyToolSet } from "../types";
import type { Prompt } from "../prompt/prompt-types";
import type { GenerationModel } from "./contract";

/** Provider-neutral generation operation supported by a model. */
export type GenerationOperation =
  | "language"
  | "image"
  | "speech"
  | "transcription"
  | "embedding";

/** Capability facet for language generation. */
export type LanguageCapability =
  | "text-input"
  | "image-input"
  | "audio-input"
  | "file-input"
  | "text-output"
  | "structured-output"
  | "tool-calls"
  | "parallel-tool-calls"
  | "streaming";

/** Capability facet for image generation. */
export type ImageCapability =
  | "text-input"
  | "image-input"
  | "multiple-output"
  | "streaming";
/** Capability facet for speech generation. */
export type SpeechCapability = "text-input" | "voice" | "streaming";
/** Capability facet for audio transcription. */
export type TranscriptionCapability =
  | "audio-input"
  | "timestamps"
  | "diarization";
/** Capability facet for embedding generation. */
export type EmbeddingCapability =
  | "text-input"
  | "image-input"
  | "batching"
  | "dimensions";

/** Complete provider-neutral capability evidence for managed generation. */
export interface GenerationCapabilities {
  readonly contract: "crux.generation-capabilities.v1";
  readonly language: readonly LanguageCapability[];
  readonly image: readonly ImageCapability[];
  readonly speech: readonly SpeechCapability[];
  readonly transcription: readonly TranscriptionCapability[];
  readonly embedding: readonly EmbeddingCapability[];
}

/** Retain exact static capability evidence from a bound model. */
export type CapabilitiesOf<M extends GenerationModel> = M["capabilities"];

type PromptHasStructuredOutput<P> =
  P extends Prompt<
    infer _TInput,
    infer TOutput,
    infer _TContexts,
    infer _TTools
  >
    ? TOutput extends z.ZodType
      ? true
      : false
    : false;

type PromptTools<P> =
  P extends Prompt<
    infer _TInput,
    infer _TOutput,
    infer _TContexts,
    infer TTools
  >
    ? TTools
    : undefined;

type HasKnownTools<TPrompt, TTools> = undefined extends TTools
  ? undefined extends PromptTools<TPrompt>
    ? false
    : true
  : true;

/** Compute statically visible language facets required by one Agent. */
export type RequiredLanguageCapabilities<TPrompt, TTools> = readonly [
  "text-input",
  "text-output",
  ...(PromptHasStructuredOutput<TPrompt> extends true
    ? readonly ["structured-output"]
    : readonly []),
  ...(HasKnownTools<TPrompt, TTools> extends true
    ? readonly ["tool-calls"]
    : readonly []),
];

type SupportsLanguage<
  TAvailable extends readonly LanguageCapability[],
  TRequired extends readonly LanguageCapability[],
> = LanguageCapability extends TAvailable[number]
  ? boolean
  : Exclude<TRequired[number], TAvailable[number]> extends never
    ? true
    : false;

/** Reject proven capability gaps while preserving broad evidence for preflight. */
export type Supports<
  TAvailable extends GenerationCapabilities,
  TRequired extends readonly LanguageCapability[],
> = SupportsLanguage<TAvailable["language"], TRequired>;

const capabilityValues = {
  language: [
    "text-input",
    "image-input",
    "audio-input",
    "file-input",
    "text-output",
    "structured-output",
    "tool-calls",
    "parallel-tool-calls",
    "streaming",
  ],
  image: ["text-input", "image-input", "multiple-output", "streaming"],
  speech: ["text-input", "voice", "streaming"],
  transcription: ["audio-input", "timestamps", "diarization"],
  embedding: ["text-input", "image-input", "batching", "dimensions"],
} as const satisfies Record<GenerationOperation, readonly string[]>;

export function freezeGenerationCapabilities<T extends GenerationCapabilities>(
  capabilities: T,
): T {
  if (capabilities.contract !== "crux.generation-capabilities.v1") {
    throw new TypeError("Generation capabilities use an unsupported contract.");
  }
  const frozen = { contract: capabilities.contract } as Record<string, unknown>;
  for (const operation of Object.keys(
    capabilityValues,
  ) as GenerationOperation[]) {
    const values = capabilities[operation];
    if (
      !Array.isArray(values) ||
      values.some(
        (value) => !capabilityValues[operation].includes(value as never),
      )
    ) {
      throw new TypeError(
        `Generation capabilities contain an invalid ${operation} facet.`,
      );
    }
    frozen[operation] = Object.freeze([...values]);
  }
  return Object.freeze(frozen) as unknown as T;
}
