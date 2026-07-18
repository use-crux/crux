/** Exhaustive pure-render prompt projection for managed task identity. @internal */

import type { AnyPrompt } from "@use-crux/core";
import { projectContexts } from "./eval-context-identity";
import {
  isRecord,
  projectJson,
  projectPolicies,
  projectSchema,
  projectTools,
  unavailable,
  type JsonProjection,
} from "./eval-task-identity-projection";

const PROMPT_CONFIG_FIELDS = new Set([
  "id",
  "description",
  "tags",
  "use",
  "input",
  "output",
  "settings",
  "adapt",
  "hooks",
  "cache",
  "tools",
  "toolApproval",
  "toolMiddleware",
  "constraints",
  "guardrails",
  "rawFields",
  "sanitize",
  "system",
  "prompt",
  "messages",
]);

export function projectPrompt(prompt: AnyPrompt): JsonProjection {
  const config = prompt.config as Record<string, unknown>;
  if (Object.keys(config).some((key) => !PROMPT_CONFIG_FIELDS.has(key))) {
    return unavailable("identity_unavailable");
  }
  if (config.sanitize !== undefined) return unavailable("identity_unavailable");
  if (
    config.hooks !== undefined ||
    config.cache !== undefined ||
    config.toolMiddleware !== undefined ||
    config.toolApproval !== undefined
  ) {
    return unavailable("untracked_external_dependency");
  }
  const inputSchema = projectSchema(prompt.inputSchema);
  if (!inputSchema.ok) return inputSchema;
  const outputSchema = projectSchema(prompt.outputSchema);
  if (!outputSchema.ok) return outputSchema;
  const tools = projectTools(config.tools);
  if (!tools.ok) return tools;
  const constraints = projectPolicies(config.constraints, "constraint");
  if (!constraints.ok) return constraints;
  const guardrails = projectPolicies(config.guardrails, "guardrail");
  if (!guardrails.ok) return guardrails;
  const content = projectPromptContent(config);
  if (!content.ok) return content;
  const contexts = projectContexts(prompt.contexts);
  if (!contexts.ok) return contexts;
  return projectJson({
    id: prompt.id ?? null,
    description: prompt.description ?? null,
    tags: prompt.tags,
    content: content.value,
    contexts: contexts.value,
    inputSchema: inputSchema.value,
    outputSchema: outputSchema.value,
    settings: config.settings ?? null,
    adapt: config.adapt ?? null,
    rawFields: config.rawFields ?? null,
    tools: tools.value,
    constraints: constraints.value,
    guardrails: guardrails.value,
  });
}

export function projectNestedPrompt(value: unknown): JsonProjection {
  return isPrompt(value)
    ? projectPrompt(value)
    : unavailable("identity_unavailable");
}

function projectPromptContent(config: Record<string, unknown>): JsonProjection {
  return config.messages !== undefined
    ? projectJson({
        mode: "messages",
        system: projectPromptSlot(config.system),
        messages: projectPromptSlot(config.messages),
      })
    : projectJson({
        mode: "prompt",
        system: projectPromptSlot(config.system),
        prompt: projectPromptSlot(config.prompt),
      });
}

function projectPromptSlot(value: unknown): unknown {
  return typeof value === "function"
    ? Object.freeze({ kind: "managed_renderer" })
    : (value ?? null);
}

function isPrompt(value: unknown): value is AnyPrompt {
  return isRecord(value) && value._tag === "Prompt";
}
