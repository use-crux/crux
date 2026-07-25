/**
 * System and prompt text normalization for prompt resolution.
 *
 * System text may be a plain string, structured segments, or opaque PromptText.
 * This module normalizes all three and infers dynamic input segments for plain
 * callback output where a primitive input value can be traced unambiguously.
 *
 * @module
 */

import type {
  ContextSystemContent,
  ContextSystemResult,
  ContextTextSegment,
} from "../prompt/context-types";
import {
  contextualizePromptTextError,
  isPromptText,
  lowerPromptText,
} from "../prompt-text/internal";
import type { ResolvedSystemContent } from "./contract";
import { summarizeSegmentFreshness } from "./freshness";
import { inferInputValueSegments } from "./system-segment-inference";

/** Token estimator injected by the caller — the resolver passes `ports.tokenizer.count`. */
type CountTokens = (text: string) => number;

function isContextSystemContent(value: unknown): value is ContextSystemContent {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { segments?: unknown }).segments)
  );
}

/**
 * Normalize a prompt or context system contribution into text plus segments.
 *
 * `count` estimates the static/dynamic token split — the caller threads the
 * resolver's `TokenizerPort.count` so segment token attribution follows the
 * same estimator as every other budget decision.
 */
export function normalizeSystemContent(
  value: ContextSystemResult | null | undefined,
  fallbackDynamic: boolean,
  count: CountTokens,
  errorLabel = "Prompt system/context function",
  inferenceInput?: unknown,
): ResolvedSystemContent {
  if (value === undefined || value === null) return { text: "" };
  if (typeof value === "string") {
    if (!value) return { text: "" };
    if (fallbackDynamic) {
      const inferredSegments = inferInputValueSegments(value, inferenceInput);
      if (inferredSegments.length > 0)
        return segmentsToSystemContent(inferredSegments, count);
    }
    return segmentsToSystemContent(
      [{ text: value, dynamic: fallbackDynamic }],
      count,
    );
  }
  if (isPromptText(value)) {
    return segmentsToSystemContent(lowerPromptText(value).segments, count);
  }
  if (!isContextSystemContent(value)) {
    throw new Error(
      `${errorLabel} must return a string, PromptText, or { segments }, got ${typeof value}. ` +
        `Value: ${JSON.stringify(value).slice(0, 200)}`,
    );
  }
  return segmentsToSystemContent(value.segments, count);
}

/** Resolve and normalize a prompt-owned system contribution. */
export async function resolveSystemContent<T>(
  value:
    | ContextSystemResult
    | ((arg: {
        input: T;
      }) => ContextSystemResult | Promise<ContextSystemResult>)
    | undefined,
  input: T,
  count: CountTokens,
  promptId?: string,
): Promise<ResolvedSystemContent> {
  try {
    if (value === undefined) return { text: "" };
    if (
      typeof value === "string" ||
      isPromptText(value) ||
      isContextSystemContent(value)
    ) {
      return normalizeSystemContent(value, false, count);
    }
    const result = await value({ input });
    return normalizeSystemContent(
      result,
      true,
      count,
      "Prompt system/context function",
      input,
    );
  } catch (error) {
    throw contextualizePromptTextError(
      error,
      `in prompt "${promptId ?? "unknown"}" field "system"`,
    );
  }
}

/**
 * Re-estimate a cached content's static/dynamic token split with `count`.
 *
 * Segments (text + dynamic flags) come from the system function and are
 * tokenizer-independent, so they are safe to cache — but their token counts are
 * not. A context-cache hit under a different `TokenizerPort` must refresh the
 * split so `staticTokens` / `dynamicTokens` stay aligned with the active
 * tokenizer for inspect attribution. Content without segments has no split to
 * refresh and is returned unchanged.
 */
export function recountSystemContent(
  content: ResolvedSystemContent,
  count: CountTokens,
): ResolvedSystemContent {
  if (!content.segments || content.segments.length === 0) return content;
  return {
    ...segmentsToSystemContent(content.segments, count),
    ...freshnessFields(content),
  };
}

/** Select only the input fields a context declared for segment inference. */
export function inputForSourceKeys(
  input: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | undefined {
  if (keys.length === 0) return undefined;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in input) picked[key] = input[key];
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function segmentsToSystemContent(
  segments: readonly ContextTextSegment[],
  count: CountTokens,
): ResolvedSystemContent {
  const normalized = segments
    .filter((segment) => segment.text.length > 0)
    .map((segment) => ({
      text: segment.text,
      dynamic: segment.dynamic,
      ...(segment.source ? { source: segment.source } : {}),
      ...(typeof segment.observedAt === "number"
        ? { observedAt: segment.observedAt }
        : {}),
      ...(segment.sourceVersion
        ? { sourceVersion: segment.sourceVersion }
        : {}),
    }));
  const text = normalized.map((segment) => segment.text).join("");
  const staticTokens = normalized
    .filter((segment) => !segment.dynamic)
    .reduce((total, segment) => total + count(segment.text), 0);
  const dynamicTokens = normalized
    .filter((segment) => segment.dynamic)
    .reduce((total, segment) => total + count(segment.text), 0);
  return {
    text,
    ...(normalized.length > 0 ? { segments: normalized } : {}),
    ...(normalized.length > 0 ? { staticTokens, dynamicTokens } : {}),
    ...summarizeSegmentFreshness(normalized),
  };
}

function freshnessFields(
  content: ResolvedSystemContent,
): Pick<
  ResolvedSystemContent,
  "servedFrom" | "resolvedAt" | "age" | "observedAt" | "sourceVersion"
> {
  return {
    ...(content.servedFrom ? { servedFrom: content.servedFrom } : {}),
    ...(typeof content.resolvedAt === "number"
      ? { resolvedAt: content.resolvedAt }
      : {}),
    ...(typeof content.age === "number" ? { age: content.age } : {}),
    ...(typeof content.observedAt === "number"
      ? { observedAt: content.observedAt }
      : {}),
    ...(content.sourceVersion ? { sourceVersion: content.sourceVersion } : {}),
  };
}
