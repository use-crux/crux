/**
 * Secret-free identity derivation for AI SDK GenerationModel bindings.
 *
 * @internal
 * @module
 */

import type { NormalizedGenerationIdentity } from "@use-crux/core";
import {
  isCascade,
  isFallback,
  isRetry,
  isRouter,
  isSplit,
} from "@use-crux/core/routing";
import {
  AI_SDK_ADAPTER_IDENTITY,
  isBoundGenerationModel,
  LANGUAGE_CAPABILITIES,
} from "./generation-model-shared";

/** Derive durable normalized identity from a native model or same-adapter route. */
export function deriveAiSdkIdentity(
  native: unknown,
): NormalizedGenerationIdentity {
  if (typeof native === "string") {
    return Object.freeze({ kind: "model", model: native });
  }
  if (typeof native !== "object" || native === null) {
    throw new TypeError(
      "aiSdk() accepts an AI SDK LanguageModel object, a string model id, or a same-adapter Crux route tree.",
    );
  }
  if (isRetry(native)) {
    return routeIdentity("retry", native.options.id ?? "retry", {
      child: leafTarget(native.model),
    });
  }
  if (isFallback(native)) {
    return routeIdentity("fallback", native.options.id ?? "fallback", {
      models: native.models.map(leafTarget),
    });
  }
  if (isSplit(native)) {
    return Object.freeze({
      kind: "router" as const,
      router: native.config.id ?? "split",
      routes: sortedRouteTargets(native.config.routes, (route) =>
        leafTarget(
          typeof route === "object" && route !== null && "model" in route
            ? (route as { model: unknown }).model
            : route,
        ),
      ),
    });
  }
  if (isCascade(native)) {
    const routes = native.config.tiers.map((tier, index) =>
      Object.freeze({
        key: String(index),
        target: leafTarget(tier.model),
      }),
    );
    return Object.freeze({
      kind: "router" as const,
      router: native.config.id ?? "cascade",
      routes: Object.freeze(routes),
    });
  }
  if (isRouter(native)) {
    return Object.freeze({
      kind: "router" as const,
      router: native.config.id ?? "router",
      routes: sortedRouteTargets(native.config.routes, (target) =>
        leafTarget(
          typeof target === "object" &&
            target !== null &&
            "model" in (target as object)
            ? (target as { model: unknown }).model
            : target,
        ),
      ),
    });
  }
  if (readCruxRouteTag(native) !== null) {
    throw new TypeError(
      "aiSdk() cannot bind an unrecognized Crux route tree. Bind each leaf model, or use a supported same-adapter router/fallback/retry/cascade/split.",
    );
  }
  const provider = readNonemptyString(native, "provider");
  const modelId = readNonemptyString(native, "modelId");
  if (provider === null || modelId === null) {
    throw new TypeError(
      "aiSdk() could not derive a secret-free identity because model.provider and model.modelId are unavailable. Use a standard AI SDK model object, or a string model id.",
    );
  }
  return Object.freeze({ kind: "model", model: `${provider}:${modelId}` });
}

/** Secret-free logical definition id for a normalized identity. */
export function definitionIdFor(
  identity: NormalizedGenerationIdentity,
): string {
  if (identity.kind === "model") {
    return `ai-sdk:${identity.model}`;
  }
  const routePart = identity.routes
    .map((route) => `${route.key}=${route.target}`)
    .join(",");
  return `ai-sdk:router:${identity.router}:{${routePart}}`;
}

/** Semantic binding-compatibility fingerprint for hard replay checks. */
export function fingerprintFor(identity: NormalizedGenerationIdentity): string {
  return [
    AI_SDK_ADAPTER_IDENTITY.id,
    AI_SDK_ADAPTER_IDENTITY.version,
    definitionIdFor(identity),
    "language",
    ...LANGUAGE_CAPABILITIES,
  ].join("|");
}

function routeIdentity(
  kind: string,
  router: string,
  detail: { child?: string; models?: readonly string[] },
): NormalizedGenerationIdentity {
  if (detail.child !== undefined) {
    return Object.freeze({
      kind: "router",
      router: `${kind}:${router}`,
      routes: Object.freeze([
        Object.freeze({ key: "model", target: detail.child }),
      ]),
    });
  }
  return Object.freeze({
    kind: "router",
    router: `${kind}:${router}`,
    routes: Object.freeze(
      (detail.models ?? []).map((target, index) =>
        Object.freeze({ key: String(index), target }),
      ),
    ),
  });
}

function sortedRouteTargets(
  routes: Record<string, unknown>,
  targetOf: (value: unknown) => string,
): readonly { readonly key: string; readonly target: string }[] {
  return Object.freeze(
    Object.keys(routes)
      .sort()
      .map((key) => Object.freeze({ key, target: targetOf(routes[key]) })),
  );
}

function leafTarget(value: unknown): string {
  if (isBoundGenerationModel(value)) {
    throw new TypeError(
      "aiSdk() binds a same-adapter router of native models only. Do not nest already-bound GenerationModel leaves; compose bound leaves with Core routers instead.",
    );
  }
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    if (readCruxRouteTag(value) !== null) {
      const nested = deriveAiSdkIdentity(value);
      return nested.kind === "model" ? nested.model : `router:${nested.router}`;
    }
    const provider = readNonemptyString(value, "provider");
    const modelId = readNonemptyString(value, "modelId");
    if (provider !== null && modelId !== null) return `${provider}:${modelId}`;
  }
  throw new TypeError(
    "aiSdk() route leaves must be string model ids or AI SDK models with provider and modelId.",
  );
}

function readCruxRouteTag(value: object): string | null {
  try {
    const tag = (value as { readonly _tag?: unknown })._tag;
    return typeof tag === "string" && tag.startsWith("crux.") ? tag : null;
  } catch {
    return null;
  }
}

function readNonemptyString(
  value: object,
  key: "provider" | "modelId",
): string | null {
  try {
    const field = (value as Record<string, unknown>)[key];
    return typeof field === "string" && field.length > 0 ? field : null;
  } catch {
    return null;
  }
}
