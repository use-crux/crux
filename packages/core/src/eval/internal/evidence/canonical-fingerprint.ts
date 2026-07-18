/** Collision-resistant portable encoding used only for fingerprints. @internal */

type Encoded = readonly unknown[];

export function canonicalFingerprintJson(value: unknown): string {
  return JSON.stringify(encode(value, new WeakSet<object>()));
}

function encode(value: unknown, seen: WeakSet<object>): Encoded {
  if (value === undefined) return ["undefined"];
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "bigint") return ["bigint", value.toString()];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "nan"];
    if (value === Number.POSITIVE_INFINITY) return ["number", "+infinity"];
    if (value === Number.NEGATIVE_INFINITY) return ["number", "-infinity"];
    if (Object.is(value, -0)) return ["number", "-0"];
    return ["number", value];
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`Cannot fingerprint ${typeof value} values.`);
  }
  if (seen.has(value)) throw new TypeError("Cannot fingerprint cyclic values.");
  seen.add(value);
  try {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) throw new TypeError("Cannot fingerprint an invalid Date.");
      return ["date", value.toISOString()];
    }
    if (value instanceof Map) {
      const entries = [...value].map(([key, entry]) => [
        encode(key, seen),
        encode(entry, seen),
      ]);
      entries.sort((left, right) => compareEncoded(left, right));
      return ["map", entries];
    }
    if (value instanceof Set) {
      const entries = [...value].map((entry) => encode(entry, seen));
      entries.sort(compareEncoded);
      return ["set", entries];
    }
    if (Array.isArray(value)) {
      const entries = Array.from({ length: value.length }, (_, index) =>
        Object.prototype.hasOwnProperty.call(value, index)
          ? encode(value[index], seen)
          : (["hole"] as const),
      );
      const properties = Object.keys(value)
        .filter((key) => !isArrayIndex(key, value.length))
        .sort()
        .map((key) => [key, encode(value[key as never], seen)] as const);
      return ["array", entries, properties];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cannot fingerprint opaque object instances.");
    }
    return [
      "object",
      Object.keys(value)
        .sort()
        .map((key) => [key, encode((value as Record<string, unknown>)[key], seen)]),
    ];
  } finally {
    seen.delete(value);
  }
}

function compareEncoded(left: unknown, right: unknown): number {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isArrayIndex(key: string, length: number): boolean {
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === key;
}
