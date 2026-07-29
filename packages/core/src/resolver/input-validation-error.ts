/**
 * Structured input-validation failure shared by canonical resolver consumers.
 *
 * The error retains only Zod's public ordered issue fields. It never stores the
 * authored or normalized input and is therefore safe for narrow projections
 * such as Runtime Bridge validation results.
 *
 * @module
 */

/** Public validation issue emitted by the merged prompt input schema. */
export interface PromptInputValidationIssue {
  readonly code: string;
  readonly path: readonly (string | number)[];
  readonly message: string;
}

/** Expected failed parse from the canonical prompt input pipeline. */
export class PromptInputValidationError extends Error {
  override readonly name = "PromptInputValidationError";

  constructor(
    readonly issues: readonly PromptInputValidationIssue[],
    message: string,
  ) {
    super(message);
  }
}

/** Normalize public issue fields without retaining schema or input objects. */
export function promptInputValidationIssues(
  value: unknown,
): readonly PromptInputValidationIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((issue) => {
    const record =
      typeof issue === "object" && issue !== null
        ? (issue as Record<string, unknown>)
        : {};
    return Object.freeze({
      code: typeof record.code === "string" ? record.code : "custom",
      path: Object.freeze(
        Array.isArray(record.path)
          ? record.path.filter(
              (part): part is string | number =>
                typeof part === "string" ||
                (typeof part === "number" &&
                  Number.isSafeInteger(part) &&
                  part >= 0),
            )
          : [],
      ),
      message:
        typeof record.message === "string"
          ? record.message
          : "Invalid prompt input.",
    });
  });
}
