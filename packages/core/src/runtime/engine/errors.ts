/**
 * Typed runtime diagnostics for durable execution.
 *
 * Public Runtime Engine failures use a stable string-literal `code` and render
 * the full diagnostic contract: what failed, why, what still works, the exact
 * next step, the code, and the docs link.
 *
 * @module
 */

/** Stable public Runtime Engine error codes. */
export const RUNTIME_ERROR_CODES = [
  "RUNTIME_REQUIRED",
  "CAPABILITY_MISSING",
  "TARGET_NOT_FOUND",
  "TARGET_DUPLICATE",
  "TARGET_NOT_EXPORTED",
  "REPLAY_DIVERGED",
  "ARTIFACTS_STALE",
  "RUNTIME_ARTIFACT_MANIFEST_INCOMPATIBLE",
  "RUNTIME_ARTIFACT_MANIFEST_INVALID",
  "WAKE_UNVERIFIED",
  "PUBLIC_URL_UNRESOLVED",
  "SETUP_REQUIRED",
  "PAYLOAD_NOT_JSON",
  "WORK_DEAD_LETTERED",
  "LEASE_LOST",
  "NAMESPACE_AMBIGUOUS",
  "RUNTIME_HOST_ONLY",
  "EVAL_RESULT_TOO_LARGE",
  "EVAL_RESULT_MEDIA_NOT_DURABLE",
] as const;

/** String-literal discriminant for public Runtime Engine diagnostics. */
export type CruxRuntimeErrorCode = (typeof RUNTIME_ERROR_CODES)[number];

/** Required parts of the public runtime diagnostic contract. */
export interface RuntimeErrorInput {
  /** Stable code from the v1 runtime error catalog. */
  readonly code: CruxRuntimeErrorCode;
  /** What failed, expressed in user-facing flow/task/target vocabulary. */
  readonly whatFailed: string;
  /** One-sentence cause of the failure. */
  readonly why: string;
  /** What can still be used before the issue is fixed. */
  readonly whatStillWorks: string;
  /** Copy-pasteable command, config, or code change that fixes the issue. */
  readonly nextStep: string;
  /** Original thrown value or adapter error, preserved for debugging. */
  readonly cause?: unknown;
}

/** Runtime diagnostic error with a stable `code` discriminant. */
export class CruxRuntimeError extends Error {
  /** Stable public Runtime Engine error code. */
  readonly code: CruxRuntimeErrorCode;
  /** What failed, expressed in user-facing flow/task/target vocabulary. */
  readonly whatFailed: string;
  /** One-sentence cause of the failure. */
  readonly why: string;
  /** What can still be used before the issue is fixed. */
  readonly whatStillWorks: string;
  /** Copy-pasteable command, config, or code change that fixes the issue. */
  readonly nextStep: string;
  /** Canonical docs URL for this error code. */
  readonly docsUrl: string;

  constructor(input: RuntimeErrorInput) {
    const docsUrl = runtimeErrorDocsUrl(input.code);
    super(formatRuntimeErrorMessage({ ...input, docsUrl }), {
      cause: input.cause,
    });
    this.name = "CruxRuntimeError";
    this.code = input.code;
    this.whatFailed = input.whatFailed;
    this.why = input.why;
    this.whatStillWorks = input.whatStillWorks;
    this.nextStep = input.nextStep;
    this.docsUrl = docsUrl;
  }
}

/**
 * Create a typed runtime diagnostic.
 *
 * Prefer this helper at public runtime boundaries so every thrown error uses
 * the same message structure and exposes the same discriminant fields.
 */
export function createRuntimeError(input: RuntimeErrorInput): CruxRuntimeError {
  return new CruxRuntimeError(input);
}

/** Return the canonical documentation URL for a runtime error code. */
export function runtimeErrorDocsUrl(code: CruxRuntimeErrorCode): string {
  return `https://cruxjs.dev/docs/errors/${code}`;
}

function formatRuntimeErrorMessage(
  input: RuntimeErrorInput & { readonly docsUrl: string },
): string {
  return [
    input.whatFailed,
    "",
    `Why: ${input.why}`,
    `What still works: ${input.whatStillWorks}`,
    `Next step: ${input.nextStep}`,
    `Code: ${input.code}`,
    `Docs: ${input.docsUrl}`,
  ].join("\n");
}
