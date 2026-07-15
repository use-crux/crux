/** Side-effect-free adapter-semantic identity for managed AI Eval tasks. @internal */

import type { AnyPrompt, JsonValue } from "@use-crux/core";
import type {
  EvalTaskIdentityProjection,
  EvalTaskIdentityProjectionRequest,
} from "@use-crux/core/eval/internal/task";
import {
  isRecord,
  projectJson,
  projectPolicies,
  projectSchema,
  projectTools,
  unavailable,
  type IdentityReason,
  type JsonProjection,
} from "./eval-task-identity-projection";

/** Create the required synchronous identity projector for one task factory. */
export function createAiTaskIdentityProjector<TResult>(input: {
  readonly operation: "generate" | "stream";
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
}): (
  request: EvalTaskIdentityProjectionRequest<TResult>,
) => EvalTaskIdentityProjection {
  return (request) => {
    const overrides = request.overrides as Record<string, unknown>;
    if (overrides.task !== undefined)
      return identityUnavailable("identity_unavailable");
    const { prompt: effectivePrompt, options } = resolveAiTaskInvocation(
      input.prompt,
      input.defaults,
      request.call,
      request.overrides,
    );

    const promptMaterial = projectPrompt(effectivePrompt);
    if (!promptMaterial.ok) return identityUnavailable(promptMaterial.reason);
    const optionMaterial = projectOptions(options);
    if (!optionMaterial.ok) return identityUnavailable(optionMaterial.reason);
    const plannedModel = projectModel(options.model);
    if (!plannedModel.ok) return identityUnavailable(plannedModel.reason);
    const modelMaterial =
      request.phase === "observed"
        ? observedModel(plannedModel.value, request.result)
        : plannedModel;
    if (!modelMaterial.ok) return identityUnavailable(modelMaterial.reason);

    return Object.freeze({
      reusable: true,
      fingerprintMaterial: Object.freeze({
        contract: "crux.ai.eval-task.v1",
        operation: input.operation,
        prompt: promptMaterial.value,
        model: modelMaterial.value,
        options: optionMaterial.value,
      }),
    });
  };
}

/** Resolve the exact prompt/options precedence shared by execution and identity. */
export function resolveAiTaskInvocation(
  prompt: AnyPrompt,
  defaults: Readonly<object>,
  call: Readonly<object> | undefined,
  overrides: Readonly<object>,
): { readonly prompt: AnyPrompt; readonly options: Record<string, unknown> } {
  const merged = {
    ...defaults,
    ...(call ?? {}),
    ...overrides,
  } as Record<string, unknown>;
  const effectivePrompt = isPrompt(merged.prompt) ? merged.prompt : prompt;
  delete merged.prompt;
  delete merged.task;
  return Object.freeze({ prompt: effectivePrompt, options: merged });
}

function projectPrompt(prompt: AnyPrompt): JsonProjection {
  const config = prompt.config as Record<string, unknown>;
  if (
    prompt.contexts.length > 0 ||
    typeof config.system === "function" ||
    typeof config.prompt === "function" ||
    typeof config.messages === "function" ||
    config.sanitize !== undefined
  ) {
    return unavailable("identity_unavailable");
  }
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
  return projectJson({
    id: prompt.id ?? null,
    system: config.system ?? null,
    prompt: config.prompt ?? null,
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

function projectOptions(options: Record<string, unknown>): JsonProjection {
  if (
    options.transport !== undefined ||
    options.toolMiddleware !== undefined ||
    options.toolApproval !== undefined ||
    options.runtimeContext !== undefined ||
    options.toolsContext !== undefined ||
    options.onStepFinish !== undefined
  ) {
    return unavailable("untracked_external_dependency");
  }
  const tools = projectTools(options.tools);
  if (!tools.ok) return tools;
  const constraints = projectPolicies(options.constraints, "constraint");
  if (!constraints.ok) return constraints;
  const guardrails = projectPolicies(options.guardrails, "guardrail");
  if (!guardrails.ok) return guardrails;
  const rest = { ...options };
  for (const key of [
    "model",
    "tools",
    "constraints",
    "guardrails",
    "transport",
    "toolMiddleware",
    "toolApproval",
    "runtimeContext",
    "toolsContext",
    "onStepFinish",
  ]) {
    delete rest[key];
  }
  return projectJson({
    ...rest,
    tools: tools.value,
    constraints: constraints.value,
    guardrails: guardrails.value,
  });
}

function projectModel(model: unknown): JsonProjection {
  if (typeof model === "string") return projectJson({ modelId: model });
  if (!isRecord(model)) return unavailable("identity_unavailable");
  if (typeof model._tag === "string" && model._tag.startsWith("crux.")) {
    return unavailable("identity_unavailable");
  }
  if (typeof model.modelId !== "string") {
    return unavailable("identity_unavailable");
  }
  return projectJson({
    provider: typeof model.provider === "string" ? model.provider : null,
    modelId: model.modelId,
    specificationVersion:
      typeof model.specificationVersion === "string"
        ? model.specificationVersion
        : null,
  });
}

function observedModel(planned: JsonValue, result: unknown): JsonProjection {
  if (!isRecord(result) || !isRecord(result.finalStep)) {
    return unavailable("identity_unavailable");
  }
  const modelId = result.finalStep.modelId;
  if (typeof modelId !== "string") return unavailable("identity_unavailable");
  if (!isRecord(planned)) return unavailable("identity_unavailable");
  return projectJson({ ...planned, modelId });
}

function identityUnavailable(
  reason: IdentityReason,
): EvalTaskIdentityProjection {
  return Object.freeze({ reusable: false, reason });
}

function isPrompt(value: unknown): value is AnyPrompt {
  return isRecord(value) && value._tag === "Prompt";
}
