/** Physical-attempt projection for completed and bounded-stream media runs. */

import { numberValue, stringValue } from "./media-run-helpers";
import { safeMediaTypes } from "./media-run-safe-values";
import type {
  GraphLikeRecord,
  MediaRunAttempt,
  MediaStreamTerminal,
} from "./media-run-projection-types";

/** Project attempt spans without ever treating a logical stream root as one. */
export function projectMediaRunAttempts(
  records: readonly GraphLikeRecord[],
  includedSpanIds: ReadonlySet<string>,
  boundedStream: boolean,
): readonly MediaRunAttempt[] {
  return Object.freeze(
    records
      .filter(
        (record) =>
          record.type === "span:start" &&
          typeof record.spanId === "string" &&
          typeof record.primitive === "string" &&
          includedSpanIds.has(record.spanId) &&
          (!boundedStream ||
            record.attributes?.streamingRole === "attempt"),
      )
      .map((start) => projectAttempt(records, start, boundedStream)),
  );
}

function projectAttempt(
  records: readonly GraphLikeRecord[],
  start: GraphLikeRecord,
  boundedStream: boolean,
): MediaRunAttempt {
  const end = records.find(
    (record) => record.type === "span:end" && record.spanId === start.spanId,
  );
  const attributes = { ...(start.attributes ?? {}), ...(end?.attributes ?? {}) };
  const provider =
    stringValue(attributes.provider) ?? stringValue(start.provider);
  const model = stringValue(attributes.model) ?? stringValue(start.model);
  const terminal = streamTerminal(attributes.terminal);
  const mediaTypes = safeMediaTypes(attributes.mediaTypes);
  return Object.freeze({
    spanId: start.spanId!,
    primitive: start.primitive!,
    name: start.name ?? start.primitive!,
    status: end?.status ?? "running",
    parentSpanId: start.parentSpanId,
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(numberValue(end?.durationMs) !== undefined
      ? { durationMs: numberValue(end?.durationMs) }
      : {}),
    ...(boundedStream ? { role: "attempt" as const } : {}),
    ...optionalNumber("attempt", attributes.attempt),
    ...optionalBoolean("committed", attributes.committed),
    ...(terminal ? { terminal } : {}),
    ...optionalNumber("previewCount", attributes.previewCount),
    ...optionalNumber("deltaCount", attributes.deltaCount),
    ...optionalNumber("finalCount", attributes.finalCount),
    ...optionalNumber("byteCount", attributes.byteCount),
    ...(mediaTypes.length > 0 ? { mediaTypes } : {}),
  });
}

function optionalNumber<TKey extends string>(
  key: TKey,
  value: unknown,
): Partial<Record<TKey, number>> {
  const number = numberValue(value);
  return number !== undefined && number >= 0
    ? ({ [key]: number } as Record<TKey, number>)
    : {};
}

function optionalBoolean<TKey extends string>(
  key: TKey,
  value: unknown,
): Partial<Record<TKey, boolean>> {
  return typeof value === "boolean"
    ? ({ [key]: value } as Record<TKey, boolean>)
    : {};
}

function streamTerminal(value: unknown): MediaStreamTerminal | undefined {
  return value === "ok" ||
    value === "error" ||
    value === "cancelled" ||
    value === "timeout"
    ? value
    : undefined;
}
