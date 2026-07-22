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

/** Stable machine code for a structured-output compilation error. */
export type StructuredOutputErrorCode =
  | "invalid-capability-profile"
  | "unsupported-structured-output";

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

  constructor(profileId: string) {
    super(
      `Provider profile "${profileId}" does not support structured output (supportsJsonSchema is false).`,
    );
    this.profileId = profileId;
  }
}
