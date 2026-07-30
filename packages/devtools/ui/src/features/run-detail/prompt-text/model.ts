import type {
  CruxContextTextSegmentPreview,
  CruxPromptTextUserPromptPreview,
} from "@use-crux/core/observability";

const PROMPT_KEYS = new Set([
  "kind",
  "text",
  "segments",
  "tokens",
  "staticTokens",
  "dynamicTokens",
]);
const SEGMENT_KEYS = new Set([
  "text",
  "dynamic",
  "source",
  "observedAt",
  "sourceVersion",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Accepts PromptText provenance only when its closed records reconstruct the
 * exact captured user prompt. Invalid evidence is never partially rendered.
 */
export function validPromptTextUserPrompt(
  value: unknown,
): CruxPromptTextUserPromptPreview | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, PROMPT_KEYS)) return undefined;
  if (
    value.kind !== "prompt-text" ||
    typeof value.text !== "string" ||
    !Array.isArray(value.segments) ||
    value.segments.length === 0 ||
    value.segments.length > 200 ||
    !isTokenCount(value.tokens) ||
    !isTokenCount(value.staticTokens) ||
    !isTokenCount(value.dynamicTokens)
  ) {
    return undefined;
  }

  const segments: Readonly<CruxContextTextSegmentPreview>[] = [];
  for (const segment of value.segments) {
    if (!isRecord(segment) || !hasOnlyKeys(segment, SEGMENT_KEYS))
      return undefined;
    if (
      typeof segment.text !== "string" ||
      typeof segment.dynamic !== "boolean" ||
      (segment.source !== undefined && typeof segment.source !== "string") ||
      (segment.sourceVersion !== undefined &&
        typeof segment.sourceVersion !== "string") ||
      (segment.observedAt !== undefined &&
        (typeof segment.observedAt !== "number" ||
          !Number.isFinite(segment.observedAt)))
    ) {
      return undefined;
    }
    segments.push({
      text: segment.text,
      dynamic: segment.dynamic,
      ...(segment.source !== undefined ? { source: segment.source } : {}),
      ...(segment.observedAt !== undefined
        ? { observedAt: segment.observedAt }
        : {}),
      ...(segment.sourceVersion !== undefined
        ? { sourceVersion: segment.sourceVersion }
        : {}),
    });
  }
  if (segments.map((segment) => segment.text).join("") !== value.text) {
    return undefined;
  }

  return {
    kind: "prompt-text",
    text: value.text,
    segments,
    tokens: value.tokens,
    staticTokens: value.staticTokens,
    dynamicTokens: value.dynamicTokens,
  };
}
