/** Exact rendered-prompt capture and evidence-candidate verification. @internal */

import type { AnyPrompt } from "@use-crux/core";
import type {
  EvalTaskIdentityProjection,
  EvalTaskIdentityProjectionRequest,
} from "@use-crux/core/eval/internal/task";
import { extractModelInfo } from "./provider-profile";
import { getStableModelIdentity } from "./stable-model";
import {
  projectJson,
  unavailable,
  type JsonProjection,
} from "./eval-task-identity-projection";
import { resolveAiTaskInvocation } from "./eval-task-identity";

const NON_SETTING_KEYS = [
  "model",
  "input",
  "routing",
  "route",
  "tools",
  "toolsContext",
  "runtimeContext",
  "toolMiddleware",
  "toolApproval",
  "messages",
  "nativeMessages",
  "tokenBudget",
  "timeout",
  "validationRetry",
  "constraints",
  "constraintMaxRetries",
  "guardrails",
  "safety",
  "activeTools",
  "maxSteps",
  "extra",
  "transport",
] as const;

/** Bind exact capture to one managed task without changing its public result. */
export function createRenderedPromptIdentity<TResult>(input: {
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
}) {
  const captured = new WeakMap<object, EvalTaskIdentityProjection>();

  return Object.freeze({
    async execute(
      run: (
        prompt: AnyPrompt,
        options: Record<string, unknown>,
      ) => Promise<TResult>,
      request: {
        readonly call?: Readonly<object>;
        readonly overrides: Readonly<object>;
        readonly input: unknown;
      },
    ): Promise<TResult> {
      const invocation = resolveAiTaskInvocation(
        input.prompt,
        input.defaults,
        request.call,
        request.overrides,
      );
      let observed: EvalTaskIdentityProjection | undefined;
      const instrumented = instrumentPrompt(invocation.prompt, (projection) => {
        observed = asIdentity(projection);
      });
      const result = await run(instrumented, {
        ...invocation.options,
        input: request.input,
      });
      if (isObject(result)) {
        captured.set(
          result,
          observed ?? unavailableIdentity("identity_unavailable"),
        );
      }
      return result;
    },

    async project(
      request: Extract<
        EvalTaskIdentityProjectionRequest<TResult>,
        { readonly phase: "plan" }
      >,
    ): Promise<EvalTaskIdentityProjection> {
      const invocation = resolveAiTaskInvocation(
        input.prompt,
        input.defaults,
        request.call,
        request.overrides,
      );
      const resolveOptions = promptResolveOptions(
        invocation.options,
        request.input,
      );
      if (!resolveOptions.ok) return unavailableIdentity(resolveOptions.reason);
      try {
        return asIdentity(
          projectResolvedPrompt(
            await invocation.prompt.resolve(resolveOptions.value as never),
          ),
        );
      } catch {
        return unavailableIdentity("untracked_external_dependency");
      }
    },

    read(result: TResult): EvalTaskIdentityProjection {
      return isObject(result)
        ? (captured.get(result) ?? unavailableIdentity("identity_unavailable"))
        : unavailableIdentity("identity_unavailable");
    },
  });
}

function instrumentPrompt(
  prompt: AnyPrompt,
  capture: (projection: JsonProjection) => void,
): AnyPrompt {
  let captured = false;
  return Object.freeze({
    ...prompt,
    resolve: async (options: never) => {
      const resolved = await prompt.resolve(options);
      if (!captured) {
        captured = true;
        capture(projectResolvedPrompt(resolved));
      }
      return resolved;
    },
  }) as AnyPrompt;
}

function projectResolvedPrompt(value: unknown): JsonProjection {
  if (!isRecord(value)) return unavailable("identity_unavailable");
  const systemBlocks = projectResolvedSystemBlocks(value.systemBlocks);
  if (!systemBlocks.ok) return systemBlocks;
  return projectJson({
    system: value.system ?? null,
    systemBlocks: systemBlocks.value,
    prompt: value.prompt ?? null,
    messages: value.messages ?? null,
    settings: value.settings ?? null,
  });
}

function projectResolvedSystemBlocks(value: unknown): JsonProjection {
  if (value === undefined) return projectJson(null);
  if (!Array.isArray(value)) return unavailable("identity_unavailable");
  const blocks: unknown[] = [];
  for (const block of value) {
    if (!isRecord(block) || typeof block.text !== "string") {
      return unavailable("identity_unavailable");
    }
    blocks.push({
      text: block.text,
      cacheBoundary: block.cacheBoundary === true,
    });
  }
  return projectJson(blocks);
}

function promptResolveOptions(
  options: Record<string, unknown>,
  input: unknown,
): JsonProjection {
  const model = options.model;
  if (
    typeof model !== "string" &&
    getStableModelIdentity(model) === undefined
  ) {
    return unavailable("untracked_external_dependency");
  }
  const info = extractModelInfo(model as never);
  const settings = { ...options };
  for (const key of NON_SETTING_KEYS) delete settings[key];
  return projectJson({
    input,
    provider: info.provider,
    modelId: info.modelId,
    tokenBudget: options.tokenBudget,
    ...settings,
  });
}

function asIdentity(projection: JsonProjection): EvalTaskIdentityProjection {
  return projection.ok
    ? Object.freeze({ reusable: true, fingerprintMaterial: projection.value })
    : unavailableIdentity(projection.reason);
}

function unavailableIdentity(
  reason: Extract<
    EvalTaskIdentityProjection,
    { readonly reusable: false }
  >["reason"],
): EvalTaskIdentityProjection {
  return Object.freeze({ reusable: false, reason });
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && !Array.isArray(value);
}
