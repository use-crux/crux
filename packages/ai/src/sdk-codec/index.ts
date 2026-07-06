import { hasToolCall as aiHasToolCall, stepCountIs } from "ai";
import type {
  GenerationSettings,
  ModelInfo,
  StopCondition as CruxStopCondition,
  ToolChoice as CruxToolChoice,
} from "@use-crux/core";
import { extractModelInfo } from "../provider-profile";
import { createLoopCallPlan } from "./loop";
import { replayStream } from "./replay";
import { createStructuredCallPlan } from "./structured";
import { createStreamCallPlan } from "./stream";
import type { AiSdkCodec, AiSdkCodecDeps } from "./types";

/**
 * Create the internal AI SDK codec used by `createAiSdkLoopRuntime()`.
 *
 * The returned object owns SDK-shaped request planning and raw-result
 * projection while the loop runtime remains responsible only for invoking the
 * selected gateway method.
 *
 * @internal
 */
export function createAiSdkCodec(deps: AiSdkCodecDeps = {}): AiSdkCodec {
  const clock = deps.clock ?? Date.now;

  return {
    executorId: "ai-sdk",

    describeModel: extractModelInfo,

    mapSettings: mapAiSdkSettings,

    loop: createLoopCallPlan,

    structured: createStructuredCallPlan,

    stream: (request) => createStreamCallPlan(request, { clock }),

    replayStream,
  };
}

/** Map neutral Crux generation settings into AI SDK call settings. */
export function mapAiSdkSettings(
  settings: GenerationSettings,
  _model?: ModelInfo,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined && !AI_SDK_MAPPED_SETTING_KEYS.has(key)) {
      mapped[key] = value;
    }
  }
  if (settings.temperature !== undefined)
    mapped.temperature = settings.temperature;
  if (settings.maxTokens !== undefined) mapped.maxTokens = settings.maxTokens;
  if (settings.topP !== undefined) mapped.topP = settings.topP;
  if (settings.topK !== undefined) mapped.topK = settings.topK;
  if (settings.stopSequences !== undefined)
    mapped.stopSequences = settings.stopSequences;
  if (settings.frequencyPenalty !== undefined)
    mapped.frequencyPenalty = settings.frequencyPenalty;
  if (settings.presencePenalty !== undefined)
    mapped.presencePenalty = settings.presencePenalty;
  if (settings.toolChoice !== undefined)
    mapped.toolChoice = aiToolChoice(settings.toolChoice);
  if (settings.stopWhen !== undefined)
    mapped.stopWhen = aiStopConditions(settings.stopWhen);
  return mapped;
}

const AI_SDK_MAPPED_SETTING_KEYS = new Set([
  "temperature",
  "maxTokens",
  "topP",
  "topK",
  "stopSequences",
  "frequencyPenalty",
  "presencePenalty",
  "toolChoice",
  "stopWhen",
  "maxSteps",
]);

function aiToolChoice(toolChoice: CruxToolChoice): unknown {
  if (typeof toolChoice === "string") return toolChoice;
  return { type: "tool", toolName: toolChoice.tool };
}

function aiStopConditions(
  stopWhen: CruxStopCondition | readonly CruxStopCondition[],
): unknown[] {
  const conditions: readonly CruxStopCondition[] = Array.isArray(stopWhen)
    ? stopWhen
    : [stopWhen];
  return conditions.map((condition) => {
    switch (condition.kind) {
      case "maxSteps":
        return stepCountIs(condition.steps);
      case "hasToolCall":
        return aiHasToolCall(condition.tool);
      default: {
        return assertNeverStopCondition(condition);
      }
    }
  });
}

function assertNeverStopCondition(condition: never): never {
  throw new Error(`Unhandled AI SDK stop condition: ${JSON.stringify(condition)}`);
}
