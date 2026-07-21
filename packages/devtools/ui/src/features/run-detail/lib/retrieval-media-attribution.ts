/** Closed, byte-safe projection of media attribution on retrieval hits. @module */

/** Structured page or time location carried by a media retrieval hit. */
export type RetrievalMediaLocation =
  | Readonly<{ type: "page"; pageNumber: number }>
  | Readonly<{ type: "time"; start: number; end: number }>;

/** The only retrieval source fields dedicated media UI is allowed to retain. */
export interface RetrievalMediaAttributionView {
  readonly assetRef?: string;
  readonly mediaType?: string;
  readonly location?: RetrievalMediaLocation;
}

/**
 * Project an arbitrary retrieval hit into an allowlisted attribution view.
 * Returns `undefined` for ordinary text hits so their legacy preview remains.
 */
export function projectRetrievalMediaAttribution(
  hit: unknown,
): RetrievalMediaAttributionView | undefined {
  const source = asRecord(asRecord(hit)?.source);
  if (!source) return undefined;

  const assetRef = nonEmptyString(asRecord(source.assetRef)?.uri);
  const mediaType = nonEmptyString(source.mediaType);
  if (!assetRef && !mediaType) return undefined;

  const location = projectLocation(source.location);
  return Object.freeze({
    ...(assetRef ? { assetRef } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(location ? { location } : {}),
  });
}

/**
 * Preserve existing text previews, but never render arbitrary content fields
 * for a hit identified as media.
 */
export function retrievalHitPreview(
  hit: Record<string, unknown>,
  attribution: RetrievalMediaAttributionView | undefined,
): string {
  if (attribution) return "";
  return firstString(hit, "preview", "contentPreview", "text", "content") ?? "";
}

/** Format a validated retrieval location for a compact attribution chip. */
export function formatRetrievalMediaLocation(
  location: RetrievalMediaLocation,
): string {
  return location.type === "page"
    ? `page ${location.pageNumber}`
    : `${formatSeconds(location.start)}–${formatSeconds(location.end)}s`;
}

function projectLocation(value: unknown): RetrievalMediaLocation | undefined {
  const location = asRecord(value);
  if (!location) return undefined;
  if (location.type === "page") {
    const pageNumber = positiveInteger(location.pageNumber);
    return pageNumber === undefined
      ? undefined
      : Object.freeze({ type: "page", pageNumber });
  }
  if (location.type === "time" && location.unit === "seconds") {
    const start = nonNegativeNumber(location.start);
    const end = nonNegativeNumber(location.end);
    return start === undefined || end === undefined || end < start
      ? undefined
      : Object.freeze({ type: "time", start, end });
  }
  return undefined;
}

function firstString(
  record: Record<string, unknown>,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = nonEmptyString(record[key]);
    if (value) return value;
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/u, "");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
