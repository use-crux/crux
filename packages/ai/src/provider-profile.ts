/**
 * Provider quirks, quarantined.
 *
 * The only file in `@use-crux/ai` allowed to branch on provider identity.
 * Everything here is a pure function keyed off `ModelInfo`: Anthropic
 * schema sanitization, Anthropic prompt-cache breakpoints, and model
 * identity extraction.
 *
 * @module
 */

import type { LanguageModel } from "ai";
import type {
  GenerationSettings,
  ModelInfo,
  SystemBlock,
} from "@use-crux/core";
import type {
  StructuredOutputCapabilities,
  StructuredOutputResolution,
  StructuredOutputResolverContext,
} from "@use-crux/core/adapter";
import { resolveAiSdkNativeModel } from "./generation-model";

/**
 * The JSON Schema behavior Anthropic accepts through the AI SDK.
 *
 * Anthropic rejects several validation keywords; core drops those during
 * lowering. Declared here because the AI SDK meta-provider cannot depend on the
 * `@use-crux/anthropic` package.
 */
const AI_SDK_ANTHROPIC_CAPABILITIES = {
  id: "ai-sdk.anthropic",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minLength",
    "maxLength",
    "pattern",
  ],
} satisfies StructuredOutputCapabilities;

/**
 * The JSON Schema behavior OpenAI and Google accept through the AI SDK.
 *
 * Both providers accept the canonical `z.input` JSON Schema the compiler emits;
 * the AI SDK forwards the compiled schema to the provider unchanged, so core
 * must apply the provider's real lowering rather than assume the SDK reverses
 * it. These profiles mirror the native `@use-crux/openai` / `@use-crux/google`
 * declarations (the AI SDK meta-provider cannot depend on those packages).
 */

/**
 * OpenAI strict mode: `@ai-sdk/openai` sends the response schema unchanged with
 * `strict: true`, so core owns the strict lowering — every property required,
 * optional-only properties encoded as required+nullable, and
 * `additionalProperties: false`. Mirrors `openAIStructuredCapabilities`.
 */
const AI_SDK_OPENAI_CAPABILITIES = {
  id: "ai-sdk.openai",
  supportsJsonSchema: true,
  requiresAllProperties: true,
  supportsOptionalProperties: false,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "must-be-false",
  unsupportedKeywords: [],
} satisfies StructuredOutputCapabilities;

/** Google Generative AI response schema. Mirrors `googleStructuredCapabilities`. */
const AI_SDK_GOOGLE_CAPABILITIES = {
  id: "ai-sdk.google",
  supportsJsonSchema: true,
  requiresAllProperties: false,
  supportsOptionalProperties: true,
  supportsNullable: true,
  supportsBooleanSchemas: false,
  supportsReferences: true,
  supportsUnions: true,
  supportsRecursiveSchemas: true,
  additionalProperties: "supported",
  unsupportedKeywords: [],
} satisfies StructuredOutputCapabilities;

/**
 * Resolve the inert structured-output capabilities a selected AI SDK model
 * accepts, or `undefined` when the model's semantics cannot be guaranteed.
 *
 * This is the `LoopRuntimePort.structuredOutput.capabilities` resolver: it only
 * selects declared capability data. Core compiles the plan from the result and
 * installs the wire schema; an `undefined` result makes core fail before
 * transport rather than inventing a default for an unknown model.
 */
export function aiSdkStructuredCapabilities(
  modelInfo: ModelInfo,
): StructuredOutputCapabilities | undefined {
  if (isAnthropicModel(modelInfo)) return AI_SDK_ANTHROPIC_CAPABILITIES;
  if (isOpenAIModel(modelInfo)) return AI_SDK_OPENAI_CAPABILITIES;
  if (isGoogleVertexModel(modelInfo) || isGoogleModel(modelInfo)) {
    return AI_SDK_GOOGLE_CAPABILITIES;
  }
  return undefined;
}

export type AiSdkStructuredOutputResolver = (
  context: StructuredOutputResolverContext,
) => StructuredOutputCapabilities | undefined;

export interface AiSdkStructuredOutputOptions {
  readonly capabilities?:
    | StructuredOutputCapabilities
    | AiSdkStructuredOutputResolver;
  readonly unknownModel?: "passthrough" | "reject";
}

export function createAiSdkStructuredOutputResolver(
  options: AiSdkStructuredOutputOptions = {},
): (context: StructuredOutputResolverContext) => StructuredOutputResolution {
  return (context) => {
    const explicit =
      typeof options.capabilities === "function"
        ? options.capabilities(context)
        : options.capabilities;
    if (explicit) {
      return {
        strategy: "explicit",
        profileId: explicit.id,
        capabilities: explicit,
      };
    }
    const inferred = aiSdkStructuredCapabilities(context.model);
    if (inferred)
      return {
        strategy: "inferred",
        profileId: inferred.id,
        capabilities: inferred,
      };
    return options.unknownModel === "reject"
      ? { strategy: "reject", profileId: "ai-sdk.unknown" }
      : { strategy: "passthrough", profileId: "ai-sdk.passthrough" };
  };
}

/**
 * Extract provider and model ID from an AI SDK `LanguageModel`.
 *
 * Handles both string IDs (e.g. `"openai:gpt-4o"`) and model objects
 * (which expose `.provider` and `.modelId` properties).
 */
export function extractModelInfo(model: LanguageModel): ModelInfo {
  const native = resolveAiSdkNativeModel(model) as LanguageModel;
  if (typeof native === "string") {
    const idx = native.indexOf(":");
    if (idx > 0) {
      return { provider: native.slice(0, idx), modelId: native.slice(idx + 1) };
    }
    return { provider: "", modelId: native };
  }
  const m = native as { provider?: unknown; modelId?: unknown };
  return {
    provider: typeof m.provider === "string" ? m.provider : "",
    modelId: typeof m.modelId === "string" ? m.modelId : "",
  };
}

/**
 * Detect whether a model targets Anthropic's API.
 *
 * Trusts only the direct Anthropic provider identity. Aggregator model IDs do
 * not identify the concrete endpoint that will receive the request.
 */
export function isAnthropicModel(modelInfo: ModelInfo): boolean {
  return (
    modelInfo.provider === "anthropic" ||
    modelInfo.provider.startsWith("anthropic.")
  );
}

/** Detect a direct OpenAI provider identity. */
export function isOpenAIModel(modelInfo: ModelInfo): boolean {
  return (
    modelInfo.provider === "openai" || modelInfo.provider.startsWith("openai.")
  );
}

/** Detect Google Vertex models whose AI SDK provider options key is `vertex`. */
export function isGoogleVertexModel(modelInfo: ModelInfo): boolean {
  return (
    modelInfo.provider === "vertex" ||
    modelInfo.provider.startsWith("vertex.") ||
    modelInfo.provider === "google-vertex" ||
    modelInfo.provider.startsWith("google-vertex.")
  );
}

/** Detect a direct Google Generative AI provider identity. */
export function isGoogleModel(modelInfo: ModelInfo): boolean {
  return (
    modelInfo.provider === "google" || modelInfo.provider.startsWith("google.")
  );
}

/**
 * Build AI SDK v6 provider options for Crux's portable reasoning setting.
 *
 * AI SDK v7 has a common `reasoning` option. This adapter currently targets
 * AI SDK v6, so the neutral setting is lowered into provider-specific option
 * bags while keeping exact budgets and summaries available through `extra`.
 */
export function aiSdkReasoningProviderOptions(
  modelInfo: ModelInfo,
  reasoning: NonNullable<GenerationSettings["reasoning"]>,
): Record<string, Record<string, unknown>> | undefined {
  if (isOpenAIModel(modelInfo)) {
    return { openai: { reasoningEffort: reasoning } };
  }
  if (isAnthropicModel(modelInfo)) {
    return {
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: ANTHROPIC_REASONING_BUDGET_TOKENS[reasoning],
        },
      },
    };
  }
  if (isGoogleVertexModel(modelInfo)) {
    return { vertex: { thinkingConfig: { thinkingLevel: reasoning } } };
  }
  if (isGoogleModel(modelInfo)) {
    return { google: { thinkingConfig: { thinkingLevel: reasoning } } };
  }
  return undefined;
}

const ANTHROPIC_REASONING_BUDGET_TOKENS = {
  low: 2000,
  medium: 8000,
  high: 24000,
} as const satisfies Record<
  NonNullable<GenerationSettings["reasoning"]>,
  number
>;

/** A system message with optional provider-specific cache options. */
export interface SystemMessageWithOptions {
  role: "system";
  content: string;
  providerOptions?: Record<string, unknown>;
}

/**
 * Build the AI SDK `system` argument from resolved system blocks.
 *
 * For Anthropic models with a Crux `cacheBoundary`, emits an array of system
 * messages carrying one native `cacheControl` marker at the stable-prefix
 * boundary. Everyone else gets the plain joined string.
 */
export function buildSystemArg(
  systemBlocks: readonly SystemBlock[] | undefined,
  system: string | undefined,
  modelInfo: ModelInfo,
): string | SystemMessageWithOptions[] | undefined {
  if (!system) return undefined;
  if (
    modelInfo &&
    isAnthropicModel(modelInfo) &&
    systemBlocks?.some((b) => b.cacheBoundary)
  ) {
    return systemBlocks.map((block) => {
      const msg: SystemMessageWithOptions = {
        role: "system",
        content: block.text,
      };
      if (block.cacheBoundary) {
        msg.providerOptions = {
          anthropic: { cacheControl: { type: "ephemeral" } },
        };
      }
      return msg;
    });
  }
  return system;
}
