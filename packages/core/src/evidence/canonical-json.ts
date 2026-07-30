/**
 * Deterministic sorted-key JSON serialization for evidence identity.
 *
 * @internal
 * @module
 */

/**
 * Serialize JSON-like evidence metadata independently of property order.
 *
 * @remarks Object keys use UTF-8 byte order, including integer-like keys that
 * `JSON.stringify()` would otherwise reorder. U+2028 and U+2029 are escaped
 * so the TypeScript and Go encoders share one unambiguous representation.
 */
export function canonicalEvidenceJson(value: unknown): string {
  const encoded = encodeCanonicalJson(value);
  if (encoded === undefined) {
    throw new TypeError("Evidence identity requires a JSON-serializable value");
  }
  return encoded;
}

function encodeCanonicalJson(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => encodeCanonicalJson(entry) ?? "null")
      .join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value)
      .sort(([left], [right]) => compareUtf8(left, right))
      .flatMap(([key, entry]) => {
        const encoded = encodeCanonicalJson(entry);
        return encoded === undefined
          ? []
          : [`${encodeJsonString(key)}:${encoded}`];
      });
    return `{${entries.join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  return encoded === undefined ? undefined : escapeSeparators(encoded);
}

function encodeJsonString(value: string): string {
  return escapeSeparators(JSON.stringify(value));
}

function escapeSeparators(value: string): string {
  return value.replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

const UTF8_ENCODER = new TextEncoder();

function compareUtf8(left: string, right: string): number {
  const leftBytes = UTF8_ENCODER.encode(left);
  const rightBytes = UTF8_ENCODER.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
