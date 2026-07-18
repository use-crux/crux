/** Stable, user-attested identity for AI SDK models used by Eval evidence. */

import type { LanguageModel } from "ai";

const MODEL_IDENTITIES = Symbol.for("@use-crux/ai/model-identity");
const localIdentities = new WeakMap<object, StableModelIdentity>();

/** Frozen model identity retained outside provider-owned model objects. @internal */
export interface StableModelIdentity {
  readonly contract: "crux.ai.stable-model.v1";
  readonly key: string;
  readonly provider: string | null;
  readonly modelId: string | null;
}

/**
 * Attest that an AI SDK model has stable execution semantics for Eval reuse.
 *
 * The optional key must be a secret-free, versioned identity that changes
 * whenever hidden endpoint, middleware, or provider configuration changes.
 * When omitted, Crux derives `provider:modelId` from standard AI SDK models.
 * The exact model reference and TypeScript type are preserved.
 */
export function stableModel<T extends LanguageModel>(
  model: T,
  key?: string,
): T {
  if (typeof model !== "object" || model === null) {
    if (key !== undefined) {
      throw new TypeError(
        "stableModel() does not accept a custom key for string model IDs. Change the model ID itself when you need to invalidate Eval evidence.",
      );
    }
    return model;
  }
  if (readCruxRouteTag(model) !== null) {
    throw new TypeError(
      "stableModel() accepts only a leaf AI SDK LanguageModel, not a Crux route tree. Attest each object model leaf instead.",
    );
  }
  const provider = readNonemptyString(model, "provider");
  const modelId = readNonemptyString(model, "modelId");
  const stableKey =
    key === undefined
      ? derivedKey(provider, modelId)
      : validateExplicitKey(key);
  const identity = Object.freeze({
    contract: "crux.ai.stable-model.v1" as const,
    key: stableKey,
    provider,
    modelId,
  });
  const identities = identityRegistry();
  const existing = identities.get(model);
  if (existing !== undefined && !sameIdentity(existing, identity)) {
    throw new TypeError(
      "stableModel() cannot give the same model object a different identity. Create a new provider model object when you bump its stable key.",
    );
  }
  identities.set(model, identity);
  return model;
}

/** Read an attested identity without inspecting provider object internals. @internal */
export function getStableModelIdentity(
  model: unknown,
): StableModelIdentity | undefined {
  return typeof model === "object" && model !== null
    ? identityRegistry().get(model)
    : undefined;
}

function identityRegistry(): WeakMap<object, StableModelIdentity> {
  const root = globalThis as typeof globalThis & {
    [MODEL_IDENTITIES]?: WeakMap<object, StableModelIdentity>;
  };
  const existing = root[MODEL_IDENTITIES];
  if (existing instanceof WeakMap) return existing;
  try {
    Object.defineProperty(root, MODEL_IDENTITIES, {
      value: localIdentities,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return root[MODEL_IDENTITIES] ?? localIdentities;
  } catch {
    return localIdentities;
  }
}

function readCruxRouteTag(value: object): string | null {
  try {
    const tag = (value as { readonly _tag?: unknown })._tag;
    return typeof tag === "string" && tag.startsWith("crux.") ? tag : null;
  } catch {
    return null;
  }
}

function derivedKey(provider: string | null, modelId: string | null): string {
  if (provider === null || modelId === null) {
    throw new TypeError(
      'stableModel() could not derive an identity because model.provider and model.modelId are unavailable. Pass a secret-free versioned key, for example stableModel(model, "my-provider:my-model:v1").',
    );
  }
  return `${provider}:${modelId}`;
}

function validateExplicitKey(key: string): string {
  if (
    key.length === 0 ||
    key.length > 512 ||
    key.trim() !== key ||
    /[\u0000-\u001f\u007f]/u.test(key)
  ) {
    throw new TypeError(
      "stableModel() key must be a non-empty secret-free versioned string of at most 512 characters, without surrounding whitespace or control characters.",
    );
  }
  return key;
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

function sameIdentity(
  left: StableModelIdentity,
  right: StableModelIdentity,
): boolean {
  return (
    left.contract === right.contract &&
    left.key === right.key &&
    left.provider === right.provider &&
    left.modelId === right.modelId
  );
}
