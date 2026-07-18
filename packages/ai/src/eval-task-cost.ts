/** Conservative per-call ceiling estimator for managed AI Eval tasks. @internal */

import type { AnyPrompt } from "@use-crux/core";
import type {
  EvalCostEstimate,
  EvalCostEstimationRequest,
} from "@use-crux/core/eval/internal/task";
import { resolveAiTaskInvocation } from "./eval-task-identity";

/** Bind cost projection to the same prompt/default precedence as execution. */
export function createAiTaskCostEstimator(input: {
  readonly prompt: AnyPrompt;
  readonly defaults: Readonly<object>;
}) {
  return (request: EvalCostEstimationRequest): EvalCostEstimate => {
    const invocation = resolveAiTaskInvocation(
      input.prompt,
      input.defaults,
      request.call,
      request.overrides,
    );
    const model =
      request.kind === "scorer"
        ? (request.billingModel ??
          (request.inheritTaskModel ? invocation.options.model : undefined))
        : invocation.options.model;
    if (hasEffectfulRouting(model)) {
      return unknownEstimate();
    }
    const missing = missingPricingKeys(model, request.pricing);
    if (missing === undefined) return unknownEstimate();
    if (missing.length > 0) return unknownEstimate(missing);
    const ceiling = modelCeiling(model, request.pricing);
    if (ceiling === undefined) return unknownEstimate();
    const steps =
      request.kind === "scorer"
        ? 1
        : maxSteps(input.prompt, invocation.options);
    if (steps === undefined) return unknownEstimate();
    return Object.freeze({
      kind: "known" as const,
      maximumUsd: ceiling * steps,
      source: "config_override" as const,
    });
  };
}

function hasEffectfulRouting(model: unknown): boolean {
  if (!isRecord(model)) return false;
  if (model._tag === "crux.router" && isRecord(model.config)) {
    return Object.values(recordField(model.config, "routes")).some(
      hasEffectfulRouting,
    );
  }
  if (model._tag === "crux.split" && isRecord(model.config)) {
    return Object.values(recordField(model.config, "routes"))
      .map(routeModel)
      .some(hasEffectfulRouting);
  }
  if (model._tag === "crux.fallback") {
    const options = isRecord(model.options) ? model.options : {};
    return (
      ["shouldFallback", "when", "onFallback"].some(
        (key) => typeof options[key] === "function",
      ) ||
      (Array.isArray(model.models) && model.models.some(hasEffectfulRouting))
    );
  }
  if (model._tag === "crux.cascade" && isRecord(model.config)) {
    const tiers = Array.isArray(model.config.tiers) ? model.config.tiers : [];
    return tiers.some(
      (tier) =>
        !isRecord(tier) ||
        typeof tier.evaluate === "function" ||
        hasEffectfulRouting(tier.model),
    );
  }
  if (model._tag === "crux.retry") return hasEffectfulRouting(model.model);
  return "model" in model && model._tag === undefined
    ? hasEffectfulRouting(model.model)
    : false;
}

function modelCeiling(
  model: unknown,
  pricing: EvalCostEstimationRequest["pricing"],
): number | undefined {
  if (pricing === undefined) return undefined;
  if (isRecord(model)) {
    if (model._tag === "crux.router" && isRecord(model.config)) {
      return maxCeiling(
        Object.values(recordField(model.config, "routes")),
        pricing,
      );
    }
    if (model._tag === "crux.split" && isRecord(model.config)) {
      const routes = Object.values(recordField(model.config, "routes"));
      return maxCeiling(routes.map(routeModel), pricing);
    }
    if (model._tag === "crux.fallback" && Array.isArray(model.models)) {
      return sumCeilings(model.models, pricing);
    }
    if (model._tag === "crux.cascade" && isRecord(model.config)) {
      const tiers = Array.isArray(model.config.tiers) ? model.config.tiers : [];
      return sumCeilings(tiers.map(routeModel), pricing);
    }
    if (model._tag === "crux.retry" && isRecord(model.options)) {
      const child = modelCeiling(model.model, pricing);
      const attempts = model.options.attempts;
      return child !== undefined && typeof attempts === "number"
        ? child * attempts
        : undefined;
    }
    if ("model" in model && model._tag === undefined) {
      return modelCeiling(model.model, pricing);
    }
  }
  return leafCeiling(model, pricing);
}

function missingPricingKeys(
  model: unknown,
  pricing: EvalCostEstimationRequest["pricing"],
): readonly string[] | undefined {
  if (isRecord(model)) {
    if (model._tag === "crux.router" && isRecord(model.config)) {
      return mergeMissing(
        Object.values(recordField(model.config, "routes")),
        pricing,
      );
    }
    if (model._tag === "crux.split" && isRecord(model.config)) {
      return mergeMissing(
        Object.values(recordField(model.config, "routes")).map(routeModel),
        pricing,
      );
    }
    if (model._tag === "crux.fallback" && Array.isArray(model.models)) {
      return mergeMissing(model.models, pricing);
    }
    if (model._tag === "crux.cascade" && isRecord(model.config)) {
      const tiers = Array.isArray(model.config.tiers) ? model.config.tiers : [];
      return mergeMissing(tiers.map(routeModel), pricing);
    }
    if (model._tag === "crux.retry") {
      return missingPricingKeys(model.model, pricing);
    }
    if ("model" in model && model._tag === undefined) {
      return missingPricingKeys(model.model, pricing);
    }
  }
  const key = modelKey(model);
  if (key === undefined) return undefined;
  if (
    pricing?.default !== undefined ||
    leafCeiling(model, pricing ?? {}) !== undefined
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([stripVersionSuffix(stripProvider(key))]);
}

function mergeMissing(
  models: readonly unknown[],
  pricing: EvalCostEstimationRequest["pricing"],
): readonly string[] | undefined {
  const keys: string[] = [];
  for (const model of models) {
    const missing = missingPricingKeys(model, pricing);
    if (missing === undefined) return undefined;
    keys.push(...missing);
  }
  return Object.freeze([...new Set(keys)].sort());
}

function leafCeiling(
  model: unknown,
  pricing: NonNullable<EvalCostEstimationRequest["pricing"]>,
): number | undefined {
  const key = modelKey(model);
  if (key === undefined) return pricing.default?.maxUsdPerCall;
  const strippedProvider = stripProvider(key);
  const strippedVersion = stripVersionSuffix(strippedProvider);
  return (
    pricing[key]?.maxUsdPerCall ??
    pricing[strippedProvider]?.maxUsdPerCall ??
    pricing[strippedVersion]?.maxUsdPerCall ??
    pricing.default?.maxUsdPerCall
  );
}

function maxCeiling(
  models: readonly unknown[],
  pricing: NonNullable<EvalCostEstimationRequest["pricing"]>,
): number | undefined {
  const values = models.map((model) => modelCeiling(model, pricing));
  return values.length > 0 && values.every(isNumber)
    ? Math.max(...values)
    : undefined;
}

function sumCeilings(
  models: readonly unknown[],
  pricing: NonNullable<EvalCostEstimationRequest["pricing"]>,
): number | undefined {
  const values = models.map((model) => modelCeiling(model, pricing));
  return values.length > 0 && values.every(isNumber)
    ? values.reduce((total, value) => total + value, 0)
    : undefined;
}

function routeModel(value: unknown): unknown {
  return isRecord(value) && "model" in value ? value.model : value;
}

function recordField(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return isRecord(value[key]) ? value[key] : {};
}

function isNumber(value: number | undefined): value is number {
  return value !== undefined;
}

function modelKey(model: unknown): string | undefined {
  if (typeof model === "string") return model;
  if (!isRecord(model)) return undefined;
  const modelId = safeString(model, "modelId");
  const provider = safeString(model, "provider");
  if (modelId === undefined) return undefined;
  return provider === undefined ? modelId : `${provider}/${modelId}`;
}

function maxSteps(
  prompt: AnyPrompt,
  options: Readonly<Record<string, unknown>>,
): number | undefined {
  const settings = isRecord(prompt.config.settings)
    ? prompt.config.settings
    : undefined;
  const value = options.maxSteps ?? settings?.maxSteps ?? 10;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function stripProvider(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

function stripVersionSuffix(model: string): string {
  const colon = model.indexOf(":");
  return colon === -1 ? model : model.slice(0, colon);
}

function safeString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  try {
    return typeof value[key] === "string" ? value[key] : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownEstimate(
  missingPricingKeys: readonly string[] = Object.freeze([]),
): EvalCostEstimate {
  return Object.freeze({
    kind: "unknown",
    source: "unknown",
    missingPricingKeys: Object.freeze([...missingPricingKeys]),
    remedy:
      missingPricingKeys.length === 0
        ? "Use a supported inert model/routing tree with a finite maxSteps bound."
        : `Add experimental.eval.pricing entries with maxUsdPerCall for: ${missingPricingKeys.join(", ")}; or add a default ceiling.`,
  });
}
