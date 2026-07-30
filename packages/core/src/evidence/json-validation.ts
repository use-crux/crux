import { evidenceInputInvalidError } from "./errors";

/** Reject values that cannot be retained as finite JSON data. @internal */
export function validateEvidenceJson(value: unknown): void {
  assertJsonValue(value, new WeakSet<object>());
}

function assertJsonValue(value: unknown, ancestors: WeakSet<object>): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (typeof value !== "object") throwJsonInputError();

  const prototype = Object.getPrototypeOf(value);
  if (
    (!Array.isArray(value) &&
      prototype !== Object.prototype &&
      prototype !== null) ||
    ancestors.has(value)
  ) {
    throwJsonInputError();
  }

  ancestors.add(value);
  try {
    const entries = Array.isArray(value) ? value : Object.values(value);
    for (const entry of entries) {
      if (entry === undefined) throwJsonInputError();
      assertJsonValue(entry, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}

function throwJsonInputError(): never {
  throw evidenceInputInvalidError(
    "Inline evidence data is not JSON-safe.",
    "Use finite JSON primitives, arrays, or plain objects without cycles.",
  );
}
