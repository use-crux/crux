/** Portable canonical JSON serialization for Eval evidence. @internal */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value)) ?? "null";
}

function sortValue(value: unknown): unknown {
  if (typeof value === "function") {
    throw new TypeError(
      "canonicalJson cannot serialize functions; fingerprint function values before canonicalization.",
    );
  }
  if (typeof value === "bigint") return { $t: "bigint", v: value.toString() };
  if (value instanceof Date) return { $t: "date", v: value.toISOString() };
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([key, entry]) => [sortValue(key), sortValue(entry)] as const)
      .sort(([left], [right]) =>
        canonicalString(left).localeCompare(canonicalString(right)),
      );
    return { $t: "map", v: entries };
  }
  if (value instanceof Set) {
    const entries = [...value]
      .map((entry) => sortValue(entry))
      .sort((left, right) =>
        canonicalString(left).localeCompare(canonicalString(right)),
      );
    return { $t: "set", v: entries };
  }
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const entry = record[key];
      if (entry !== undefined) sorted[key] = sortValue(entry);
    }
    return sorted;
  }
  return value;
}

function canonicalString(value: unknown): string {
  return JSON.stringify(value) ?? "null";
}
