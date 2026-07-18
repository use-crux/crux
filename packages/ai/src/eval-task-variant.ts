import type { AnyPrompt } from "@use-crux/core";
import { projectSchema } from "./eval-task-identity-projection";

const AI_TASK_VARIANT_KEYS = new Set([
  "task",
  "prompt",
  "model",
  "temperature",
  "maxTokens",
  "topP",
  "topK",
  "stopSequences",
  "seed",
  "reasoning",
  "toolChoice",
  "stopWhen",
  "maxSteps",
  "frequencyPenalty",
  "presencePenalty",
]);

/** Validate the runtime half of the typed AI Variant contract. @internal */
export function validateAiTaskVariantOverrides(
  overrides: Readonly<Record<string, unknown>>,
  basePrompt: AnyPrompt,
): void {
  for (const key of Object.keys(overrides)) {
    if (!AI_TASK_VARIANT_KEYS.has(key)) {
      throw new TypeError(
        `AI Eval Variant override '${key}' is not supported. Use prompt, model, task, or a portable generation setting.`,
      );
    }
  }
  if (
    overrides.prompt !== undefined &&
    (!isRecord(overrides.prompt) || overrides.prompt._tag !== "Prompt")
  ) {
    throw new TypeError("AI Eval Variant `prompt` must be a Crux prompt.");
  }
  if (
    isRecord(overrides.prompt) &&
    overrides.prompt._tag === "Prompt" &&
    basePrompt.outputSchema !== undefined &&
    schemaContract((overrides.prompt as unknown as AnyPrompt).outputSchema) !==
      schemaContract(basePrompt.outputSchema)
  ) {
    throw new TypeError(
      "AI Eval Variant `prompt` must preserve the structured output schema.",
    );
  }
  if (
    isRecord(overrides.prompt) &&
    overrides.prompt._tag === "Prompt" &&
    overrides.prompt.hasOutput !== basePrompt.hasOutput
  ) {
    throw new TypeError(
      "AI Eval Variant `prompt` must preserve text or structured output mode. Use a compatible prompt or replace the full Eval task.",
    );
  }
  if (
    isRecord(overrides.prompt) &&
    overrides.prompt._tag === "Prompt" &&
    containsPromptContentCallback(overrides.prompt)
  ) {
    throw new TypeError(
      "AI Eval Variant `prompt` cannot contain callbacks because their source is not a durable Variant identity. Move the prompt into an imported managed task and replace the Variant `task` instead.",
    );
  }
  if (
    overrides.model !== undefined &&
    !isSupportedModelValue(overrides.model)
  ) {
    throw new TypeError(
      "AI Eval Variant `model` must be a supported model or router.",
    );
  }
}

function containsPromptContentCallback(
  prompt: Record<string, unknown>,
): boolean {
  if (!isRecord(prompt.config)) return true;
  const config = prompt.config;
  return ["system", "prompt", "messages"].some(
    (key) => typeof config[key] === "function",
  );
}

function schemaContract(schema: unknown): string | undefined {
  const projected = projectSchema(schema);
  return projected.ok ? JSON.stringify(projected.value) : undefined;
}

/** Validate an effective prompt override against one selected Case. @internal */
export async function validateAiTaskVariantInput(
  input: unknown,
  overrides: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!isRecord(overrides.prompt) || overrides.prompt._tag !== "Prompt") return;
  const prompt = overrides.prompt as unknown as AnyPrompt;
  if (prompt.inputSchema === undefined) return;
  const result = await prompt.inputSchema["~standard"].validate(input);
  if (result.issues === undefined) return;
  throw new TypeError(
    result.issues
      .map((issue) => {
        const path = issue.path
          ?.map((segment) =>
            typeof segment === "object" && segment !== null
              ? String(segment.key)
              : String(segment),
          )
          .join(".");
        return path === undefined || path.length === 0
          ? issue.message
          : `${path}: ${issue.message}`;
      })
      .join("; "),
  );
}

/** Fail before inference when a model Variant introduces routing call requirements. */
export function validateAiTaskVariantCall(
  call: Readonly<Record<string, unknown>> | undefined,
  overrides: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
): void {
  const model = overrides.model ?? call?.model ?? defaults.model;
  if (!containsContextualRouting(model)) return;
  if (!isRecord(call?.routing)) {
    throw new TypeError(
      "AI Eval Variant model uses contextual routing; add `call: { routing: { ... } }` to this Case.",
    );
  }
  if (call?.route !== undefined && typeof call.route !== "string") {
    throw new TypeError("AI Eval Case `call.route` must be a route name.");
  }
}

/** Routing changes cannot claim one durable call contract without runtime schemas. */
export function aiTaskCallContract(
  operation: "generate" | "stream",
  defaults: Readonly<Record<string, unknown>>,
): string | undefined {
  return isRoutable(defaults.model)
    ? undefined
    : `crux.ai.${operation}.call.v2:direct-model`;
}

function containsContextualRouting(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (!isRecord(value) || seen.has(value)) return false;
  seen.add(value);
  if (value._tag === "crux.router" || value._tag === "crux.split") return true;
  if (value._tag === "crux.retry")
    return containsContextualRouting(value.model, seen);
  if (value._tag === "crux.fallback" && Array.isArray(value.models)) {
    return value.models.some((model) => containsContextualRouting(model, seen));
  }
  if (
    value._tag === "crux.cascade" &&
    isRecord(value.config) &&
    Array.isArray(value.config.tiers)
  ) {
    return value.config.tiers.some(
      (tier) => isRecord(tier) && containsContextualRouting(tier.model, seen),
    );
  }
  return false;
}

function isRoutable(value: unknown): boolean {
  return isRecord(value) && String(value._tag).startsWith("crux.");
}

function isSupportedModelValue(value: unknown): boolean {
  if (typeof value === "string") return value.length > 0;
  if (!isRecord(value)) return false;
  if (
    typeof value.provider === "string" &&
    typeof value.modelId === "string" &&
    typeof value.specificationVersion === "string"
  ) {
    return true;
  }
  return [
    "crux.router",
    "crux.cascade",
    "crux.retry",
    "crux.split",
    "crux.fallback",
  ].includes(String(value._tag));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
