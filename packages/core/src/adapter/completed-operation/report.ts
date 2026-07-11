/** Closed descriptor facts emitted by completed media operations. */
export type CompletedOperationReport = Readonly<{
  kind: "image" | "audio" | "video" | "file";
  count?: number;
  segments?: number;
  words?: number;
  durationSeconds?: number;
}>;

/** Project an untrusted provider report onto the strict descriptor allowlist. */
export function safeCompletedOperationReport(
  value: unknown,
): CompletedOperationReport | undefined {
  if (!isRecord(value) || !isKind(value.kind)) return undefined;
  return Object.freeze({
    kind: value.kind,
    ...nonNegative("count", value.count),
    ...nonNegative("segments", value.segments),
    ...nonNegative("words", value.words),
    ...nonNegative("durationSeconds", value.durationSeconds),
  });
}

function nonNegative<TKey extends string>(
  key: TKey,
  value: unknown,
): Partial<Record<TKey, number>> {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? ({ [key]: value } as Record<TKey, number>)
    : {};
}

function isKind(value: unknown): value is CompletedOperationReport["kind"] {
  return (
    value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "file"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
