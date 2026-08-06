/**
 * Shared constants and type guards for AI SDK GenerationModel binding.
 *
 * @internal
 * @module
 */

import type {
  AdapterBoundGenerationModel,
  GenerationCapabilities,
  LanguageCapability,
} from "@use-crux/core";

/** Adapter identity and durable execution-contract version for this package. */
export const AI_SDK_ADAPTER_IDENTITY = Object.freeze({
  id: "ai-sdk",
  version: "1",
});

/** Language facets declared for AI SDK language-model bindings. */
export const LANGUAGE_CAPABILITIES = [
  "text-input",
  "text-output",
  "structured-output",
  "tool-calls",
  "parallel-tool-calls",
  "streaming",
] as const satisfies readonly LanguageCapability[];

/** Complete capability manifest with unsupported families left empty. */
export const AI_SDK_GENERATION_CAPABILITIES = {
  contract: "crux.generation-capabilities.v1",
  language: LANGUAGE_CAPABILITIES,
  image: [],
  speech: [],
  transcription: [],
  embedding: [],
} as const satisfies GenerationCapabilities;

/** True when value is any Core adapter-bound generation model. */
export function isBoundGenerationModel(
  value: unknown,
): value is AdapterBoundGenerationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly _tag?: unknown })._tag === "crux.generation-model" &&
    "native" in value
  );
}
