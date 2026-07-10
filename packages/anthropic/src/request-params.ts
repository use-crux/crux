import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type {
  GenerationSettings,
  SystemBlock,
  ToolChoice,
} from "@use-crux/core";
import type { CallArgs } from "@use-crux/core/adapter";
import type { NativeChatRequestArgs } from "@use-crux/core/adapter";
import type { AnthropicExtra, AnthropicRequest } from "./types";

/** Default `max_tokens` when a call site does not provide one. */
export const DEFAULT_MAX_TOKENS = 4096;

/**
 * Cast a request body into Anthropic's non-streaming message params.
 *
 * The SDK types are intentionally closed over many provider fields, while the
 * adapter assembles them from canonical settings plus provider-native extras.
 * This helper keeps that boundary cast in one place.
 */
export function asAnthropicNonStreamingParams(
  params: Record<string, unknown>,
): Anthropic.MessageCreateParamsNonStreaming {
  return params as unknown as Anthropic.MessageCreateParamsNonStreaming;
}

/**
 * Cast a request body into Anthropic's streaming message params.
 *
 * Keep this paired with {@link asAnthropicNonStreamingParams} so request
 * assembly stays consistent between `call()` and `stream()`.
 */
export function asAnthropicStreamingParams(
  params: Record<string, unknown>,
): Anthropic.MessageCreateParamsStreaming {
  return params as unknown as Anthropic.MessageCreateParamsStreaming;
}

/** Build the Anthropic request body from canonical Crux call arguments. */
export function anthropicRequest(
  args: NativeChatRequestArgs<AnthropicExtra, Anthropic.MessageParam>,
): AnthropicRequest {
  const system = anthropicSystemParam(args.system, args.systemBlocks);
  return {
    model: args.model,
    ...(system ? { system } : {}),
    messages: [...args.providerMessages],
    ...args.settings,
    ...anthropicToolParams(args.tools, args.extra),
    max_tokens: anthropicMaxTokens(args.settings),
    ...(args.schemaParams ?? {}),
  };
}

/**
 * Build the Anthropic `system` request field from Crux system blocks.
 *
 * Anthropic supports explicit cache-control breakpoints. Crux marks the
 * stable-prefix boundary during prompt resolution, so the adapter emits one
 * native breakpoint on that block instead of marking every cached block.
 */
export function anthropicSystemParam(
  system: string | undefined,
  systemBlocks: readonly SystemBlock[] | undefined,
): string | Anthropic.TextBlockParam[] | undefined {
  if (!systemBlocks?.some((block) => block.cacheBoundary)) return system;

  return systemBlocks.map((block) => {
    const textBlock: Anthropic.TextBlockParam = {
      type: "text",
      text: block.text,
    };
    if (block.cacheBoundary) {
      textBlock.cache_control = { type: "ephemeral" };
    }
    return textBlock;
  });
}

/**
 * Build Anthropic tool declaration params from either provider-native extras or
 * canonical Crux tool definitions.
 */
export function anthropicToolParams(
  tools: CallArgs["tools"],
  extra:
    | {
        readonly tools?: readonly Anthropic.ToolUnion[];
        readonly tool_choice?: Anthropic.ToolChoice;
      }
    | undefined,
): Record<string, unknown> {
  const toolParams: Record<string, unknown> = {};

  if (extra?.tools && extra.tools.length > 0) {
    toolParams.tools = extra.tools;
  } else if (tools && tools.length > 0) {
    toolParams.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema:
        Object.keys(tool.parameters).length > 0
          ? tool.parameters
          : { type: "object" as const, properties: {} },
    }));
  }

  if (extra?.tool_choice) {
    toolParams.tool_choice = extra.tool_choice;
  }

  return toolParams;
}

/** Read Anthropic's required `max_tokens` value from mapped settings. */
export function anthropicMaxTokens(settings: Record<string, unknown>): number {
  return typeof settings.max_tokens === "number"
    ? settings.max_tokens
    : DEFAULT_MAX_TOKENS;
}

/** Map canonical generation settings to Anthropic-native request fields. */
export function mapAnthropicSettings(
  settings: GenerationSettings,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (settings.temperature !== undefined)
    result.temperature = settings.temperature;
  result.max_tokens = settings.maxTokens ?? DEFAULT_MAX_TOKENS;
  if (settings.topP !== undefined) result.top_p = settings.topP;
  if (settings.topK !== undefined) result.top_k = settings.topK;
  if (settings.stopSequences !== undefined)
    result.stop_sequences = settings.stopSequences;
  if (settings.toolChoice !== undefined)
    result.tool_choice = anthropicToolChoice(settings.toolChoice);
  if (settings.reasoning !== undefined)
    result.thinking = anthropicReasoningConfig(settings.reasoning);

  const knownKeys = new Set([
    "temperature",
    "maxTokens",
    "topP",
    "topK",
    "seed",
    "frequencyPenalty",
    "presencePenalty",
    "stopSequences",
    "toolChoice",
    "stopWhen",
    "maxSteps",
    "reasoning",
    "unsupportedContent",
  ]);
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && !knownKeys.has(key) && !(key in result)) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Crux's portable reasoning levels are budgeted for Claude thinking models.
 *
 * These defaults intentionally stay coarse: callers that need exact budgets,
 * adaptive thinking, or thought-output controls should use Anthropic `extra`.
 */
const ANTHROPIC_REASONING_BUDGET_TOKENS = {
  low: 2000,
  medium: 8000,
  high: 24000,
} as const satisfies Record<NonNullable<GenerationSettings["reasoning"]>, number>;

function anthropicReasoningConfig(
  reasoning: NonNullable<GenerationSettings["reasoning"]>,
): Anthropic.ThinkingConfigParam {
  return {
    type: "enabled",
    budget_tokens: ANTHROPIC_REASONING_BUDGET_TOKENS[reasoning],
  };
}

function anthropicToolChoice(toolChoice: ToolChoice): Anthropic.ToolChoice {
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "none") return { type: "none" };
  if (toolChoice === "required") return { type: "any" };
  return { type: "tool", name: toolChoice.tool };
}

/** Convert a Zod schema into Anthropic's structured-output params. */
export function anthropicOutputSchema(
  schema: z.ZodType,
): Record<string, unknown> {
  return {
    // Anthropic's helper ships with its own Zod typings; cross-version
    // `z.ZodType` shapes do not structurally align, so widen at this boundary.
    output_config: {
      format: zodOutputFormat(schema as Parameters<typeof zodOutputFormat>[0]),
    },
  };
}

/**
 * Strip `description` fields from a JSON schema.
 *
 * Anthropic rejects tool parameter schemas containing nested descriptions; this
 * recursively preserves every other field.
 */
export function stripDescriptions(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = stripDescriptions(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? stripDescriptions(item as Record<string, unknown>)
          : item,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}
