/**
 * Best-effort source-key inference for dynamic plain-string system content.
 *
 * This compatibility path predates PromptText. It deliberately treats equal
 * primitive values as ambiguous and never claims a source for overlapping
 * matches.
 *
 * @module
 */

import type { ContextTextSegment } from "../prompt/context-types";

interface PrimitiveInputValue {
  source: string;
  value: string;
}

/** Infer unambiguous primitive input spans within resolved plain text. */
export function inferInputValueSegments(
  text: string,
  input: unknown,
): ContextTextSegment[] {
  const values = uniquePrimitiveInputValues(input);
  if (values.length === 0) return [];
  const matches: Array<{
    start: number;
    end: number;
    source: string;
    value: string;
  }> = [];
  for (const entry of values) {
    let start = text.indexOf(entry.value);
    while (start >= 0) {
      matches.push({
        start,
        end: start + entry.value.length,
        source: entry.source,
        value: entry.value,
      });
      start = text.indexOf(entry.value, start + entry.value.length);
    }
  }
  if (matches.length === 0) return [];

  const selected: typeof matches = [];
  for (const match of matches.sort(
    (left, right) =>
      left.start - right.start || right.value.length - left.value.length,
  )) {
    const overlaps = selected.some(
      (existing) => match.start < existing.end && match.end > existing.start,
    );
    if (!overlaps) selected.push(match);
  }
  selected.sort((left, right) => left.start - right.start);

  const segments: ContextTextSegment[] = [];
  let cursor = 0;
  for (const match of selected) {
    if (match.start > cursor) {
      segments.push({ text: text.slice(cursor, match.start), dynamic: false });
    }
    segments.push({
      text: text.slice(match.start, match.end),
      dynamic: true,
      source: match.source,
    });
    cursor = match.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), dynamic: false });
  }
  return segments;
}

function uniquePrimitiveInputValues(input: unknown): PrimitiveInputValue[] {
  const values = collectPrimitiveInputValues(input);
  const byValue = new Map<string, PrimitiveInputValue[]>();
  for (const value of values) {
    if (value.value.trim().length === 0) continue;
    const bucket = byValue.get(value.value) ?? [];
    bucket.push(value);
    byValue.set(value.value, bucket);
  }
  return [...byValue.values()]
    .filter((bucket) => bucket.length === 1)
    .map((bucket) => bucket[0]!)
    .sort(
      (left, right) =>
        right.value.length - left.value.length ||
        left.source.localeCompare(right.source),
    );
}

function collectPrimitiveInputValues(
  input: unknown,
  path: string[] = [],
  seen = new WeakSet<object>(),
): PrimitiveInputValue[] {
  if (path.length === 0 && (input === null || input === undefined)) return [];
  if (
    typeof input === "string" ||
    typeof input === "number" ||
    typeof input === "boolean" ||
    typeof input === "bigint"
  ) {
    return path.length > 0
      ? [{ source: path.join("."), value: String(input) }]
      : [];
  }
  if (input instanceof Date) {
    return path.length > 0
      ? [{ source: path.join("."), value: input.toISOString() }]
      : [];
  }
  if (input === null || typeof input !== "object") return [];
  if (seen.has(input)) return [];
  seen.add(input);

  const out: PrimitiveInputValue[] = [];
  if (Array.isArray(input)) {
    input.forEach((value, index) =>
      out.push(
        ...collectPrimitiveInputValues(value, [...path, String(index)], seen),
      ),
    );
    return out;
  }
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out.push(...collectPrimitiveInputValues(value, [...path, key], seen));
  }
  return out;
}
