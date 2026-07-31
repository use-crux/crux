/**
 * Side-effect-free prospective planning for one language-model request.
 *
 * @module
 */

import type { AnyAgent } from "../../agent/agent";
import { isAgent } from "../../agent/agent";
import { createToolLifecycle } from "../../adapter/tool/session";
import type { CallArgs } from "../../adapter/types";
import { toCanonicalJsonSchema } from "../../adapter/structured-output";
import { initialCoreMessageState } from "../../adapter/execution/messages";
import type { AnyPrompt } from "../../prompt/prompt-types";
import { compilePrompt } from "../../resolver/compile";
import {
  resolveModelCapacityProfile,
  type ModelCountingConfidence,
} from "../capacity/model-profile";
import { deriveInputBudget } from "../budget/derive";
import { estimateRequestTokens } from "../measure/estimate";
import {
  observeRepresentationPolicies,
  prospectiveRepresentationPolicies,
} from "../representation/prepare";
import { observeManagedHistoryPolicy } from "../history/preview-policy";
import {
  minimumPreviewCandidate,
  previewAdaptations,
  selectPreviewCandidate,
} from "./candidates";
import type { RequestPreview, RequestPreviewOptions } from "./types";

/** A Prompt or Agent definition accepted by {@link preview}. */
export type RequestPreviewTarget = AnyPrompt | AnyAgent;

/**
 * Plan a request observationally without reserving or executing it.
 *
 * Read-only source resolution and existing artifact lookup are allowed.
 * Preview never generates summaries, publishes offloads, schedules
 * maintenance, executes Tools, or invokes preparation callbacks.
 *
 * @param target - Prompt or Agent whose initial provider request is inspected.
 * @param options - Typed invocation values and request-pressure settings.
 * @returns A tri-state prospective fit result.
 * @throws For invalid input, invalid composition, or a missing concrete model.
 *
 * @example
 * ```ts
 * const result = await preview(writer, {
 *   input: { topic: "Release notes" },
 *   inputBudget: { max: 8_000 },
 * });
 * ```
 */
export async function preview(
  target: RequestPreviewTarget,
  options: RequestPreviewOptions = {},
): Promise<RequestPreview> {
  const normalized = normalizeTarget(target, options);
  const model = modelIdentity(normalized.model);
  if (!model) {
    throw new TypeError(
      "Request preview requires options.model or an Agent model.",
    );
  }
  const provider = options.provider ?? "";
  const pass = await compilePrompt(normalized.prompt.config).resolve({
    input: options.input,
    provider,
    modelId: model,
    ...(options.settings ?? {}),
  });
  const resolved = pass.args;
  const messageState = initialCoreMessageState(
    resolved,
    options.messages ? [...options.messages] : undefined,
  );
  const lifecycle = createToolLifecycle({
    regime: "core",
    resolved,
    call: {
      tools: normalized.tools,
    },
    promptId: normalized.prompt.id,
    input: options.input,
  });
  const request: CallArgs = {
    model,
    system: resolved.system,
    systemBlocks: resolved.systemBlocks,
    messages: messageState.messages,
    settings: { ...resolved.settings },
    schema: resolved.schema,
    outputSchema: resolved.schema
      ? toCanonicalJsonSchema(resolved.schema)
      : undefined,
    tools: lifecycle.descriptors
      ? [...lifecycle.descriptors]
      : undefined,
    extra: {},
  };
  const profile = resolveModelCapacityProfile(model);
  const measurement: ModelCountingConfidence =
    profile.countingConfidence;
  const budget = deriveInputBudget({
    profile,
    settings: resolved.settings,
    inputBudget: normalized.inputBudget,
    measurement,
  });
  const exact = estimateRequestTokens(request, { provider });
  let policies = await observeRepresentationPolicies({
    policies: resolved.representations ?? [],
    provider,
    model,
  });
  const warnings = [...(messageState.history?.warnings ?? [])];
  if (
    messageState.history?.policy === "managed" &&
    messageState.history.projection
  ) {
    const managed = await observeManagedHistoryPolicy({
      projection: messageState.history.projection,
      messages: request.messages,
      provider,
      model,
      max: budget.max,
    });
    if (managed.policy) policies = [managed.policy, ...policies];
    warnings.push(...managed.warnings);
  }
  const available = selectPreviewCandidate(
    request,
    policies,
    budget.optimizeAt,
    budget.max,
    provider,
  );
  const incompleteRuntimeSource =
    (resolved.toolSources?.length ?? 0) > 0;
  if (available && !incompleteRuntimeSource) {
    return result({
      status: "fits",
      model,
      inputTokens: available.inputTokens,
      maxInputTokens: budget.max,
      measurement,
      adaptations: previewAdaptations(
        available,
        policies,
        available.inputTokens,
      ),
      warnings,
      diagnostics: [],
    });
  }
  const prospectivePolicies = prospectiveRepresentationPolicies(policies);
  const prospective = selectPreviewCandidate(
    request,
    prospectivePolicies,
    budget.optimizeAt,
    budget.max,
    provider,
  );
  if (prospective || incompleteRuntimeSource) {
    const candidate = prospective ?? available;
    return result({
      status: "unknown",
      model,
      ...(candidate ? { inputTokens: candidate.inputTokens } : {}),
      maxInputTokens: budget.max,
      measurement: "incomplete",
      adaptations: candidate
        ? previewAdaptations(
            candidate,
            policies,
            candidate.inputTokens,
          )
        : [],
      warnings,
      diagnostics: incompleteRuntimeSource
        ? [{
            id: "preview:runtime-source",
            code: "PREVIEW_RUNTIME_SOURCE",
            message:
              "A runtime-only Tool source prevents complete pre-execution measurement.",
          }]
        : [],
    });
  }
  const minimum = minimumPreviewCandidate(
    request,
    prospectivePolicies,
    provider,
  );
  const measured = minimum?.inputTokens ?? exact.inputTokens;
  return result({
    status: "over-limit",
    model,
    inputTokens: measured,
    maxInputTokens: budget.max,
    measurement,
    adaptations: minimum
      ? previewAdaptations(minimum, policies, measured)
      : [],
    warnings,
    diagnostics: [{
      id: "preview:input-limit",
      code: "REQUEST_INPUT_LIMIT",
      tokens: measured,
      message:
        `Minimum prospective input is ${measured} tokens; ${budget.max} are available.`,
    }],
  });
}

function normalizeTarget(
  target: RequestPreviewTarget,
  options: RequestPreviewOptions,
): {
  readonly prompt: AnyPrompt;
  readonly model: unknown;
  readonly tools?: Record<string, unknown>;
  readonly inputBudget?: RequestPreviewOptions["inputBudget"];
} {
  if (!isAgent(target)) {
    return {
      prompt: target,
      model: options.model,
      tools: options.tools,
      inputBudget: options.inputBudget,
    };
  }
  return {
    prompt: target.prompt,
    model: options.model ?? target.model,
    tools: {
      ...(target.tools ?? {}),
      ...(options.tools ?? {}),
    },
    inputBudget: options.inputBudget ?? target.inputBudget,
  };
}

function modelIdentity(model: unknown): string | undefined {
  if (typeof model === "string" && model) return model;
  if (!model || typeof model !== "object") return undefined;
  const candidate = model as {
    readonly modelId?: unknown;
    readonly id?: unknown;
  };
  if (typeof candidate.modelId === "string") return candidate.modelId;
  if (typeof candidate.id === "string") return candidate.id;
  return undefined;
}

function result(input: RequestPreview): RequestPreview {
  return Object.freeze({
    ...input,
    adaptations: Object.freeze([...input.adaptations]),
    warnings: Object.freeze([...input.warnings]),
    diagnostics: Object.freeze([...input.diagnostics]),
  });
}
