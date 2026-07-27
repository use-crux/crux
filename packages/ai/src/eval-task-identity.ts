/** Side-effect-free adapter-semantic identity for managed AI Eval tasks. @internal */

import type { AnyPrompt } from "@use-crux/core";
import type {
  EvalTaskScorerContextRequest,
  EvalTaskIdentityProjection,
  EvalTaskIdentityProjectionRequest,
} from "@use-crux/core/eval/internal/task";
import { resolveTaskTimeoutOverrideForInternalUse } from "@use-crux/core/eval/internal/task";
import {
  isRecord,
  projectJson,
  projectPolicies,
  projectTools,
  unavailable,
  type IdentityReason,
  type JsonProjection,
} from "./eval-task-identity-projection";
import { projectModel, projectObservedModel } from "./eval-model-identity";
import { projectNestedPrompt, projectPrompt } from "./eval-prompt-identity";

type GenerateFn = (prompt: never, options: never) => Promise<unknown>;

/** Create the required synchronous identity projector for one task factory. */
export function createAiTaskIdentityProjector<TResult>(input: {
  readonly operation: "generate" | "stream";
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
  readonly executionContractKnown: boolean;
}): (
  request: EvalTaskIdentityProjectionRequest<TResult>,
) => EvalTaskIdentityProjection {
  return (request) => {
    if (!input.executionContractKnown) {
      return identityUnavailable("untracked_external_dependency");
    }
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
    const plannedModel = projectModel(options.model, true, projectNestedPrompt);
    if (!plannedModel.ok) return identityUnavailable(plannedModel.reason);
    const modelMaterial =
      request.phase === "observed"
        ? projectObservedModel(plannedModel.value, request.result)
        : plannedModel;
    if (!modelMaterial.ok) return identityUnavailable(modelMaterial.reason);

    return Object.freeze({
      reusable: true,
      fingerprintMaterial: Object.freeze({
        contract: "crux.ai.eval-task.v2",
        operation: input.operation,
        prompt: promptMaterial.value,
        model: modelMaterial.value,
        options: optionMaterial.value,
      }),
    });
  };
}

/** Project the adapter/model binding inherited by managed Eval scorers. */
export function createAiScorerContextProjector(input: {
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
  readonly generate: GenerateFn;
  readonly executionContractKnown: boolean;
}): (request: EvalTaskScorerContextRequest) => EvalTaskIdentityProjection {
  return (request) => {
    if (
      !input.executionContractKnown ||
      (request.generate !== undefined && request.generate !== input.generate)
    ) {
      return identityUnavailable("untracked_external_dependency");
    }
    const invocation = resolveAiTaskInvocation(
      input.prompt,
      input.defaults,
      request.call,
      request.overrides,
    );
    const model = projectModel(
      request.model ?? invocation.options.model,
      request.authoredSourceFingerprint !== undefined,
      projectNestedPrompt,
    );
    if (!model.ok) return identityUnavailable(model.reason);
    const generationOptions = projectJson({
      routing: invocation.options.routing ?? null,
    });
    if (!generationOptions.ok) {
      return identityUnavailable(generationOptions.reason);
    }
    return Object.freeze({
      reusable: true,
      fingerprintMaterial: Object.freeze({
        contract: "crux.ai.eval-scorer-context.v1",
        adapter: "ai-sdk",
        operation: "generate",
        model: model.value,
        generationOptions: generationOptions.value,
      }),
    });
  };
}

/** Bind the actual adapter/model only after the planner admitted scorer work. */
export function createAiScorerContextBinder(input: {
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
  readonly generate: GenerateFn;
}) {
  return (request: EvalTaskScorerContextRequest) => {
    const invocation = resolveAiTaskInvocation(
      input.prompt,
      input.defaults,
      request.call,
      request.overrides,
    );
    return Object.freeze({
      generate: request.generate ?? input.generate,
      model: request.model ?? invocation.options.model,
      ...(invocation.options.routing !== undefined
        ? {
            generationOptions: Object.freeze({
              routing: invocation.options.routing,
            }),
          }
        : {}),
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
  const merged = mergeTaskOptions(mergeTaskOptions(defaults, call), overrides);
  const effectivePrompt = isPrompt(merged.prompt) ? merged.prompt : prompt;
  delete merged.prompt;
  delete merged.task;
  return Object.freeze({ prompt: effectivePrompt, options: merged });
}

function mergeTaskOptions(
  base: Readonly<object>,
  override: Readonly<object> | undefined,
): Record<string, unknown> {
  if (override === undefined) return { ...base };
  const merged = { ...base, ...override } as Record<string, unknown>;
  if (Object.hasOwn(override, "timeout")) {
    const baseTimeout = (base as Record<string, unknown>).timeout;
    const overrideTimeout = (override as Record<string, unknown>).timeout;
    merged.timeout = resolveTaskTimeoutOverrideForInternalUse(
      baseTimeout,
      overrideTimeout,
    );
  }
  return merged;
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

function identityUnavailable(
  reason: IdentityReason,
): EvalTaskIdentityProjection {
  return Object.freeze({ reusable: false, reason });
}

function isPrompt(value: unknown): value is AnyPrompt {
  return isRecord(value) && value._tag === "Prompt";
}
