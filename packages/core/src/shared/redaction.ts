/**
 * Shared redaction primitives for safety, validation feedback, and Eval
 * snapshots.
 *
 * These helpers are intentionally conservative and dependency-free. They are
 * not anonymization; they remove common secrets and high-risk identifiers from
 * previews and persisted snapshots before they cross observability or model
 * feedback boundaries.
 *
 * @module
 */

/** Replacement string for structurally redacted values. */
export const REDACTED = "[redacted]";

/** Key names that are always redacted at every object depth. */
export const SENSITIVE_KEY_PATTERN =
  /^(authorization|proxy[-_]?authorization|api[-_]?key|x[-_]?api[-_]?key|token|secret)$/i;

/** Validate and canonicalize project-owned dot-path redaction policy. */
export function normalizeRedactPaths(value: unknown): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.some((path) => typeof path !== "string")) {
    throw new TypeError(
      "observability.redactPaths must be an array of dot-path strings.",
    );
  }
  const paths = [
    ...new Set((value as string[]).map((path) => path.trim())),
  ].sort();
  if (
    paths.some(
      (path) =>
        path.length === 0 ||
        path.length > 512 ||
        /[\u0000-\u001f\u007f]/u.test(path) ||
        path.split(".").some((segment) => segment.length === 0),
    )
  ) {
    throw new TypeError(
      "observability.redactPaths must contain non-empty dot paths without control characters.",
    );
  }
  return Object.freeze(paths);
}

/** Redact common sensitive text patterns from a preview string. */
export function redactSensitiveText(content: string): string {
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{1,}/gi, "[redacted-email]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]")
    .replace(
      /\b(?:sk|pk|rk|key|token)-[A-Za-z0-9_-]{3,}\b/g,
      "[redacted-secret]",
    )
    .replace(
      /\b(?:authorization|proxy-authorization)\s*[:=]\s*bearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
      "[redacted-authorization]",
    );
}

/** Recursively redact sensitive keys from JSON-like values. */
export function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value))
    return value.map((item) => redactSensitiveValue(item));
  if (!isRecord(value)) return value;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : redactSensitiveValue(entry);
  }
  return output;
}

/**
 * Apply configured dot-path redaction plus the always-on sensitive-key rules.
 *
 * @remarks Arrays are transparent to paths: `items.secret` redacts `secret`
 * from every object in `items`. The input is never mutated.
 *
 * @param value - JSON-like value to project into a safe copy.
 * @param paths - Normalized dot paths such as `user.email`.
 * @returns A detached value containing redaction markers at protected paths.
 */
export function applyRedaction(
  value: unknown,
  paths: readonly string[],
): unknown {
  return redactNode(
    value,
    paths.map((path) => path.split(".")),
  );
}

function redactNode(
  value: unknown,
  paths: ReadonlyArray<readonly string[]>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactNode(item, paths));
  }
  if (value === null || typeof value !== "object") return value;
  if (!isPlainRecord(value)) {
    throw new TypeError(
      "Eval snapshot cannot persist non-plain object values; use plain objects, arrays, and primitive values.",
    );
  }

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const matching = paths.filter((path) => path[0] === key);
    const projected =
      SENSITIVE_KEY_PATTERN.test(key) ||
      matching.some((path) => path.length === 1)
        ? REDACTED
        : redactNode(
            entry,
            matching.map((path) => path.slice(1)),
          );
    Object.defineProperty(output, key, {
      value: projected,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
