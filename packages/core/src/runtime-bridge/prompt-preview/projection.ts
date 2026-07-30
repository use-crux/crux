/**
 * Closed projection from canonical resolver inspection to exact-preview wire.
 *
 * Resolver provenance is accepted only when its ordered segments reconstruct
 * the containing text exactly. Any malformed provenance falls back to one
 * full-text `unknown` span instead of exposing misleading attribution.
 *
 * @module
 */

import type { ContextTextSegment } from "../../prompt/context-types";
import type { InspectResult } from "../../resolver/types";
import {
  PromptPreviewReadyResultSchema,
  type PromptPreviewResult,
} from "./result-protocol";
import {
  PROMPT_PREVIEW_MAX_RESULT_BYTES,
  PROMPT_PREVIEW_MAX_SEGMENTS,
  PROMPT_PREVIEW_MAX_STRING_AGGREGATE_BYTES,
  compactJson,
  utf8Bytes,
} from "./limits";
import { ScalarValidStringSchema } from "./protocol";

export class PromptPreviewResultLimitError extends Error {
  override readonly name = "PromptPreviewResultLimitError";
}

/** Project the allowlisted fields of one canonical inspection. */
export function projectPromptInspection(
  targetId: string,
  catalogueRevision: number,
  inspection: InspectResult,
): PromptPreviewResult {
  const parts = inspection.system.parts.map((part) => ({
    source: part.source,
    text: part.text,
    tokens: part.tokens,
    skipped: part.skipped,
    segments: projectSegments(part.text, part.segments),
    ...(part.staticTokens !== undefined
      ? { staticTokens: part.staticTokens }
      : {}),
    ...(part.dynamicTokens !== undefined
      ? { dynamicTokens: part.dynamicTokens }
      : {}),
  }));
  const reconstructedSystem = parts
    .filter((part) => !part.skipped && part.text.length > 0)
    .map((part) => part.text)
    .join("\n\n");
  const result = {
    status: "ready" as const,
    targetId,
    catalogueRevision,
    inspection: {
      system: {
        text: inspection.system.total,
        tokens: inspection.system.totalTokens,
        coverage:
          reconstructedSystem === inspection.system.total
            ? ("complete" as const)
            : ("partial" as const),
        parts,
      },
      ...(inspection.prompt
        ? {
            prompt: {
              text: inspection.prompt.text,
              tokens: inspection.prompt.tokens,
              segments: projectSegments(
                inspection.prompt.text,
                inspection.prompt.segments,
              ),
              ...(inspection.prompt.staticTokens !== undefined
                ? { staticTokens: inspection.prompt.staticTokens }
                : {}),
              ...(inspection.prompt.dynamicTokens !== undefined
                ? { dynamicTokens: inspection.prompt.dynamicTokens }
                : {}),
            },
          }
        : {}),
      totalTokens: inspection.totalTokens,
      droppedContexts: inspection.droppedContexts.map((context) => ({
        source: context.source,
        text: context.text,
        tokens: context.tokens,
        priority: context.priority,
        segments: projectSegments(context.text, context.segments),
      })),
      excludedContexts: inspection.excludedContexts.map((context) => ({
        source: context.source,
        reason: context.reason,
      })),
      ...(inspection.tools ? { tools: [...inspection.tools] } : {}),
    },
  };
  const parsed = PromptPreviewReadyResultSchema.parse(result);
  assertResultLimits(parsed);
  return parsed;
}

function projectSegments(
  text: string,
  segments: readonly ContextTextSegment[] | undefined,
) {
  if (text.length === 0) return [];
  if (!segments) return [unknownSegment(text)];

  const nonempty = segments.filter((segment) => segment.text.length > 0);
  if (
    nonempty.length === 0 ||
    nonempty.map((segment) => segment.text).join("") !== text ||
    nonempty.some((segment) => !validSegmentMetadata(segment))
  ) {
    return [unknownSegment(text)];
  }
  let startUtf16 = 0;
  return nonempty.map((segment) => {
    const endUtf16 = startUtf16 + segment.text.length;
    const projected = {
      kind: segment.dynamic ? ("dynamic" as const) : ("static" as const),
      startUtf16,
      endUtf16,
      ...(segment.source ? { source: segment.source } : {}),
      ...(segment.observedAt !== undefined
        ? { observedAt: segment.observedAt }
        : {}),
      ...(segment.sourceVersion
        ? { sourceVersion: segment.sourceVersion }
        : {}),
    };
    startUtf16 = endUtf16;
    return projected;
  });
}

function unknownSegment(text: string) {
  return {
    kind: "unknown" as const,
    startUtf16: 0,
    endUtf16: text.length,
  };
}

function validSegmentMetadata(segment: ContextTextSegment): boolean {
  return (
    validOptionalString(segment.source, 512) &&
    validOptionalString(segment.sourceVersion, 256) &&
    (segment.observedAt === undefined ||
      (Number.isSafeInteger(segment.observedAt) && segment.observedAt >= 0))
  );
}

function validOptionalString(
  value: string | undefined,
  maxLength: number,
): boolean {
  return (
    value === undefined ||
    (value.length > 0 &&
      value.length <= maxLength &&
      ScalarValidStringSchema.safeParse(value).success)
  );
}

function assertResultLimits(
  result: ReturnType<typeof PromptPreviewReadyResultSchema.parse>,
): void {
  if (
    stringBytes(result) > PROMPT_PREVIEW_MAX_STRING_AGGREGATE_BYTES ||
    segmentCount(result) > PROMPT_PREVIEW_MAX_SEGMENTS ||
    compactJson(result).bytes > PROMPT_PREVIEW_MAX_RESULT_BYTES
  ) {
    throw new PromptPreviewResultLimitError(
      "Exact-preview result exceeds a limit.",
    );
  }
}

function stringBytes(value: unknown): number {
  if (typeof value === "string") return utf8Bytes(value);
  if (Array.isArray(value)) {
    return value.reduce((total, child) => total + stringBytes(child), 0);
  }
  if (typeof value !== "object" || value === null) return 0;
  return Object.values(value).reduce(
    (total, child) => total + stringBytes(child),
    0,
  );
}

function segmentCount(
  result: ReturnType<typeof PromptPreviewReadyResultSchema.parse>,
): number {
  const inspection = result.inspection;
  return (
    inspection.system.parts.reduce(
      (total, part) => total + part.segments.length,
      0,
    ) +
    (inspection.prompt?.segments.length ?? 0) +
    inspection.droppedContexts.reduce(
      (total, context) => total + context.segments.length,
      0,
    )
  );
}
