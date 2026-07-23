/**
 * Structured-output compilation errors.
 *
 * These are the fatal outcomes of compilation: a contradictory capability
 * profile, or a request for structured output from a profile that cannot accept
 * a JSON Schema. Each carries a stable `code` and names the offending profile so
 * the failure is actionable without leaking schema content.
 *
 * @module
 */

/** Stable machine code for a structured-output compilation or decode error. */
export type StructuredOutputErrorCode =
  | "invalid-capability-profile"
  | "unsupported-structured-output"
  | "unsupported-schema"
  | "provider-output-decode-failure";

/**
 * A capability profile declares a contradictory or unsupported combination.
 *
 * @remarks
 * `conflicts` lists each offending field combination in plain language so the
 * provider author can correct the profile definition.
 */
export class CruxInvalidCapabilityProfileError extends Error {
  override readonly name = "CruxInvalidCapabilityProfileError";
  readonly code: StructuredOutputErrorCode = "invalid-capability-profile";
  /** Identity of the profile that failed validation. */
  readonly profileId: string;
  /** Human-readable descriptions of each conflicting field combination. */
  readonly conflicts: readonly string[];

  constructor(profileId: string, conflicts: readonly string[]) {
    super(
      `Invalid structured-output capability profile "${profileId}": ${conflicts.join(
        "; ",
      )}`,
    );
    this.profileId = profileId;
    this.conflicts = conflicts;
  }
}

/**
 * Structured output was requested from a profile that cannot accept JSON Schema.
 *
 * @remarks
 * Thrown before any provider request is built, so an unsupported provider fails
 * fast rather than sending an invalid request.
 */
export class CruxUnsupportedStructuredOutputError extends Error {
  override readonly name = "CruxUnsupportedStructuredOutputError";
  readonly code: StructuredOutputErrorCode = "unsupported-structured-output";
  /** Identity of the profile that does not support structured output. */
  readonly profileId: string;

  constructor(
    profileId: string,
    reason: string = "supportsJsonSchema is false",
  ) {
    super(
      `Provider profile "${profileId}" does not support structured output (${reason}).`,
    );
    this.profileId = profileId;
  }
}

/**
 * A schema uses a semantic the profile cannot soundly represent.
 *
 * @remarks
 * Raised when lowering would be unsound rather than merely approximate — for
 * example a recursive schema under a profile that does not support recursion, or
 * an optional occurrence that cannot be reversibly encoded. Names the offending
 * canonical path when one applies, without leaking schema content.
 */
export class CruxUnsupportedSchemaError extends Error {
  override readonly name = "CruxUnsupportedSchemaError";
  readonly code: StructuredOutputErrorCode = "unsupported-schema";
  /** Identity of the profile the schema was compiled against. */
  readonly profileId: string;
  /** Canonical path of the offending occurrence, when local. */
  readonly path?: readonly (string | number | "*")[];

  constructor(
    profileId: string,
    reason: string,
    path?: readonly (string | number | "*")[],
  ) {
    const at = path && path.length > 0 ? ` at "${path.join(".")}"` : "";
    super(
      `Provider profile "${profileId}" cannot represent this schema${at}: ${reason}.`,
    );
    this.profileId = profileId;
    if (path !== undefined) this.path = path;
  }
}

/**
 * A provider value could not be decoded against a plan's decode manifest.
 *
 * @remarks
 * Raised when a manifest path exists in the provider value but has the wrong
 * shape to traverse (for example an object was expected but a string was found).
 * A merely absent occurrence is not an error — it is skipped.
 */
export class CruxStructuredOutputDecodeError extends Error {
  override readonly name = "CruxStructuredOutputDecodeError";
  readonly code: StructuredOutputErrorCode = "provider-output-decode-failure";
  /** Canonical path where decoding could not proceed. */
  readonly path: readonly (string | number | "*")[];

  constructor(path: readonly (string | number | "*")[], reason: string) {
    super(
      `Failed to decode provider structured output at "${path.join(
        ".",
      )}": ${reason}.`,
    );
    this.path = path;
  }
}
