/**
 * Safe Runs projection for logical bounded image and speech streams.
 *
 * Only closed scalar progress and canonical Safety coordinates are admitted.
 * Prompts, locators, bytes, provider events, and arbitrary report fields never
 * enter this view model.
 */

import { asRecord, numberValue, stringValue } from "./media-run-helpers";
import { safeMediaTypes } from "./media-run-safe-values";
import type {
  BoundedMediaStreamRun,
  GraphLikeRecord,
  MediaStreamSafetyOccurrence,
  MediaStreamTerminal,
} from "./media-run-projection-types";

/** Project a logical stream's merged attributes and scoped Safety artifacts. */
export function projectBoundedMediaStreamRun(
  attributes: Readonly<Record<string, unknown>>,
  artifacts: readonly GraphLikeRecord[],
): BoundedMediaStreamRun | undefined {
  const operation = streamOperation(attributes.operation);
  if (operation === undefined || attributes.streamingRole !== "logical") {
    return undefined;
  }
  const terminal = streamTerminal(attributes.terminal);
  if (terminal === undefined) return undefined;
  const occurrences = safetyOccurrences(artifacts, operation);
  const enforcing = occurrences.some(
    (occurrence) => occurrence.mode === "enforce",
  );
  const blocked = occurrences.some(
    (occurrence) => occurrence.action === "block",
  );
  return Object.freeze({
    operation,
    role: "logical",
    ...(safeLabel(attributes.route)
      ? { route: safeLabel(attributes.route) }
      : {}),
    committed: attributes.committed === true,
    attemptCount: nonNegativeCount(attributes.attemptCount),
    previewCount: nonNegativeCount(attributes.previewCount),
    deltaCount: nonNegativeCount(attributes.deltaCount),
    finalCount: nonNegativeCount(attributes.finalCount),
    byteCount: nonNegativeCount(attributes.byteCount),
    mediaTypes: safeMediaTypes(attributes.mediaTypes),
    ...(nonNegativeNumber(attributes.firstEventMs) !== undefined
      ? { firstPublicEventMs: nonNegativeNumber(attributes.firstEventMs) }
      : {}),
    ...(nonNegativeNumber(attributes.durationMs) !== undefined
      ? { durationMs: nonNegativeNumber(attributes.durationMs) }
      : {}),
    terminal,
    safety: Object.freeze({
      occurrences: Object.freeze(occurrences),
      blocked,
      deltaDelivery: enforcing
        ? blocked || terminal !== "ok"
          ? "held-discarded"
          : "held-released"
        : occurrences.some((occurrence) => occurrence.mode === "report")
          ? "live"
          : "not-observed",
    }),
  });
}

function safetyOccurrences(
  artifacts: readonly GraphLikeRecord[],
  operation: BoundedMediaStreamRun["operation"],
): MediaStreamSafetyOccurrence[] {
  return artifacts.flatMap((artifact) => {
    if (artifact.kind !== "guardrail.report") return [];
    const report = asRecord(artifact.preview);
    if (
      report?.kind !== "guardrail.report" ||
      report.originKind !== "operation" ||
      report.operation !== operation
    ) {
      return [];
    }
    const phase =
      report.operationPhase === "preview" || report.operationPhase === "final"
        ? report.operationPhase
        : undefined;
    if (!phase) return [];
    const mediaPartType = mediaPart(report.mediaPartType);
    const outputIndex = nonNegativeNumber(report.outputIndex);
    const sequence = nonNegativeNumber(report.sequence);
    return [
      Object.freeze({
        phase,
        mode:
          report.mode === "enforce" || report.mode === "report"
            ? report.mode
            : "unknown",
        action: safetyAction(report.action),
        ...(mediaPartType ? { mediaPartType } : {}),
        ...(outputIndex !== undefined ? { outputIndex } : {}),
        ...(sequence !== undefined ? { sequence } : {}),
      }),
    ];
  });
}

function streamOperation(
  value: unknown,
): BoundedMediaStreamRun["operation"] | undefined {
  return value === "streamImage" || value === "streamSpeech"
    ? value
    : undefined;
}

function streamTerminal(value: unknown): MediaStreamTerminal | undefined {
  return value === "ok" ||
    value === "error" ||
    value === "cancelled" ||
    value === "timeout"
    ? value
    : undefined;
}

function safetyAction(
  value: unknown,
): MediaStreamSafetyOccurrence["action"] {
  return value === "allow" ||
    value === "strip" ||
    value === "block" ||
    value === "warn"
    ? value
    : "unknown";
}

function mediaPart(
  value: unknown,
): MediaStreamSafetyOccurrence["mediaPartType"] | undefined {
  return value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "file"
    ? value
    : undefined;
}

function nonNegativeCount(value: unknown): number {
  return Math.floor(Math.max(0, numberValue(value) ?? 0));
}

function nonNegativeNumber(value: unknown): number | undefined {
  const number = numberValue(value);
  return number !== undefined && number >= 0 ? number : undefined;
}

function safeLabel(value: unknown): string | undefined {
  const label = stringValue(value);
  if (!label || label.length > 120 || label.includes("://")) return undefined;
  return label;
}
