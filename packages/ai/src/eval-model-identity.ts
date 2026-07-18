/** Structural identity for Crux routing trees and their AI SDK leaves. @internal */

import type { JsonValue } from "@use-crux/core";
import {
  isRecord,
  projectJson,
  unavailable,
  type JsonProjection,
} from "./eval-task-identity-projection";
import { getStableModelIdentity } from "./stable-model";

type PromptProjector = (value: unknown) => JsonProjection;

export function projectModel(
  model: unknown,
  callbacksCovered = false,
  projectPrompt?: PromptProjector,
): JsonProjection {
  if (typeof model === "string") return projectJson({ modelId: model });
  const identity = getStableModelIdentity(model);
  if (identity !== undefined) return projectJson(identity);
  if (!isRecord(model)) return unavailable("model_identity_unattested");
  switch (model._tag) {
    case "crux.retry":
      return projectRetry(model, callbacksCovered, projectPrompt);
    case "crux.fallback":
      return projectFallback(model, callbacksCovered, projectPrompt);
    case "crux.split":
      return projectSplit(model, callbacksCovered, projectPrompt);
    case "crux.cascade":
      return projectCascade(model, callbacksCovered, projectPrompt);
    case "crux.router":
      return projectRouter(model, callbacksCovered, projectPrompt);
    default:
      return unavailable("model_identity_unattested");
  }
}

export function projectObservedModel(
  planned: JsonValue,
  result: unknown,
): JsonProjection {
  if (!isRecord(result) || !isRecord(result.finalStep)) {
    return unavailable("identity_unavailable");
  }
  const modelId = result.finalStep.modelId;
  if (typeof modelId !== "string" || !isRecord(planned)) {
    return unavailable("identity_unavailable");
  }
  if (
    typeof planned.kind === "string" &&
    ["router", "cascade", "split", "fallback", "retry"].includes(
      planned.kind,
    )
  ) {
    return projectJson({ ...planned, resolvedModelId: modelId });
  }
  if (planned.contract === "crux.ai.stable-model.v1" && planned.modelId === null) {
    return { ok: true, value: planned };
  }
  return projectJson({ ...planned, modelId });
}

function projectRetry(model: Record<string, unknown>, covered: boolean, prompt?: PromptProjector) {
  const child = projectModel(model.model, covered, prompt);
  if (!child.ok) return child;
  const options = projectJson(model.options);
  return options.ok
    ? projectJson({ kind: "retry", model: child.value, options: options.value })
    : options;
}

function projectFallback(model: Record<string, unknown>, covered: boolean, prompt?: PromptProjector) {
  if (!Array.isArray(model.models) || !isRecord(model.options)) {
    return unavailable("identity_unavailable");
  }
  const models = projectModels(model.models, covered, prompt);
  if (!models.ok) return models;
  const options = projectCallbacks(
    model.options,
    ["shouldFallback", "when", "onFallback"],
    covered,
  );
  return options.ok
    ? projectJson({ kind: "fallback", models: models.value, options: options.value })
    : options;
}

function projectSplit(model: Record<string, unknown>, covered: boolean, prompt?: PromptProjector) {
  const config = model.config;
  if (!isRecord(config) || !isRecord(config.routes)) {
    return unavailable("identity_unavailable");
  }
  const routes: Record<string, JsonValue> = {};
  for (const key of Object.keys(config.routes).sort()) {
    const route = projectModelRecord(config.routes[key], covered, prompt);
    if (!route.ok) return route;
    routes[key] = route.value;
  }
  const rest = { ...config };
  delete rest.routes;
  const projected = projectCallbacks(rest, ["seed"], covered);
  return projected.ok && isRecord(projected.value)
    ? projectJson({ kind: "split", config: { ...projected.value, routes } })
    : projected.ok
      ? unavailable("identity_unavailable")
      : projected;
}

function projectCascade(model: Record<string, unknown>, covered: boolean, prompt?: PromptProjector) {
  const config = model.config;
  if (!isRecord(config) || !Array.isArray(config.tiers)) {
    return unavailable("identity_unavailable");
  }
  const tiers: JsonValue[] = [];
  for (const value of config.tiers) {
    if (!isRecord(value) || !("model" in value)) {
      return unavailable("identity_unavailable");
    }
    const child = projectModel(value.model, covered, prompt);
    if (!child.ok) return child;
    const rest = { ...value };
    delete rest.model;
    const tier = projectCallbacks(rest, ["evaluate"], covered);
    if (!tier.ok || !isRecord(tier.value)) {
      return tier.ok ? unavailable("identity_unavailable") : tier;
    }
    tiers.push(Object.freeze({ model: child.value, ...tier.value }));
  }
  const rest = { ...config };
  delete rest.tiers;
  delete rest.prompt;
  const projected = projectJson(rest);
  if (!projected.ok || !isRecord(projected.value)) {
    return projected.ok ? unavailable("identity_unavailable") : projected;
  }
  const boundPrompt =
    config.prompt === undefined
      ? { ok: true as const, value: null }
      : prompt?.(config.prompt) ?? unavailable("identity_unavailable");
  return boundPrompt.ok
    ? projectJson({
        kind: "cascade",
        config: { ...projected.value, prompt: boundPrompt.value, tiers },
      })
    : boundPrompt;
}

function projectRouter(model: Record<string, unknown>, covered: boolean, prompt?: PromptProjector) {
  if (!covered) return unavailable("unresolved_source_dependency");
  const config = model.config;
  if (!isRecord(config) || !isRecord(config.routes)) {
    return unavailable("identity_unavailable");
  }
  const routes: Record<string, JsonValue> = {};
  for (const key of Object.keys(config.routes).sort()) {
    const route = projectRouteTarget(config.routes[key], covered, prompt);
    if (!route.ok) return route;
    routes[key] = route.value;
  }
  const rest = { ...config };
  delete rest.routes;
  const projected = projectCallbacks(rest, ["classify"], covered);
  return projected.ok && isRecord(projected.value)
    ? projectJson({ kind: "router", ...projected.value, routes })
    : projected.ok
      ? unavailable("identity_unavailable")
      : projected;
}

function projectModels(
  values: readonly unknown[],
  covered: boolean,
  prompt?: PromptProjector,
): JsonProjection {
  const result: JsonValue[] = [];
  for (const value of values) {
    const child = projectModel(value, covered, prompt);
    if (!child.ok) return child;
    result.push(child.value);
  }
  return { ok: true, value: Object.freeze(result) };
}

function projectModelRecord(
  value: unknown,
  covered: boolean,
  prompt?: PromptProjector,
): JsonProjection {
  if (!isRecord(value) || !("model" in value)) {
    return unavailable("identity_unavailable");
  }
  const child = projectModel(value.model, covered, prompt);
  if (!child.ok) return child;
  const rest = { ...value };
  delete rest.model;
  const projected = projectJson(rest);
  return projected.ok && isRecord(projected.value)
    ? projectJson({ model: child.value, ...projected.value })
    : projected.ok
      ? unavailable("identity_unavailable")
      : projected;
}

function projectRouteTarget(
  value: unknown,
  covered: boolean,
  prompt?: PromptProjector,
): JsonProjection {
  if (!isRecord(value) || !("model" in value)) {
    return projectModel(value, covered, prompt);
  }
  const child = projectModel(value.model, covered, prompt);
  if (!child.ok) return child;
  const options = { ...value };
  delete options.model;
  const projected = projectJson(options);
  return projected.ok
    ? projectJson({ model: child.value, options: projected.value })
    : projected;
}

function projectCallbacks(
  value: Record<string, unknown>,
  keys: readonly string[],
  covered: boolean,
): JsonProjection {
  const projected = { ...value };
  for (const key of keys) {
    if (typeof projected[key] !== "function") continue;
    if (!covered) return unavailable("unresolved_source_dependency");
    return unavailable("untracked_external_dependency");
  }
  return projectJson(projected);
}
