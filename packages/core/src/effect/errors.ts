/**
 * Stable public diagnostics for effect execution and recovery.
 *
 * @module
 */

import type {
  EffectReceiptRef,
  RollbackResult,
} from "./types";

/** Stable public effect diagnostic codes, including reserved future codes. */
export const EFFECT_ERROR_CODES = [
  "EFFECT_DUPLICATE_ID",
  "EFFECT_RESOURCE_FAILED",
  "EFFECT_CAPTURE_FAILED",
  "EFFECT_RECOVERY_REQUIRED",
  "EFFECT_SCOPE_NOT_FOUND",
  "EFFECT_RECEIPT_NOT_FOUND",
  "EFFECT_SCOPE_TERMINAL",
  "EFFECT_OUTCOME_AMBIGUOUS",
  "EFFECT_ROLLBACK_PARTIAL",
  "EFFECT_RECOVERY_NOT_DURABLE",
  "EFFECT_RECOVERY_HANDLER_UNAVAILABLE",
  "EFFECT_RECOVERY_SHARED_UNIT",
  "EFFECT_RECOVERY_CONFLICT",
  "EFFECT_NATIVE_RECOVERY_UNSUPPORTED",
] as const;

/** String-literal discriminant for public effect diagnostics. */
export type CruxEffectErrorCode = (typeof EFFECT_ERROR_CODES)[number];

/** Required fields for a public effect diagnostic. */
export interface EffectErrorInput {
  /** Stable code from the effect error catalog. */
  readonly code: CruxEffectErrorCode;
  /** Concise description of the failed operation. */
  readonly message: string;
  /** Original error preserved across the effect boundary. */
  readonly cause?: unknown;
}

/**
 * Error thrown when an effect lifecycle contract cannot be honored.
 *
 * @example
 * ```ts
 * try {
 *   await rollback(scope)
 * } catch (error) {
 *   if (error instanceof CruxEffectError) {
 *     console.error(error.code, error.docsUrl)
 *   }
 * }
 * ```
 */
export class CruxEffectError extends Error {
  /** Stable machine-readable diagnostic code. */
  readonly code: CruxEffectErrorCode;
  /** Canonical documentation URL for this diagnostic. */
  readonly docsUrl: string;

  /**
   * Create a structured effect diagnostic.
   *
   * @param input - Stable code, message, and optional original cause.
   */
  constructor(input: EffectErrorInput) {
    const docsUrl = `https://cruxjs.dev/docs/errors/${input.code}`;
    super(`${input.message}\n\nCode: ${input.code}\nDocs: ${docsUrl}`, {
      cause: input.cause,
    });
    this.name = "CruxEffectError";
    this.code = input.code;
    this.docsUrl = docsUrl;
  }
}

/** Details attached when an executor cannot determine its external outcome. */
export type EffectOutcomeUnknownDetails = Readonly<
  Record<string, unknown>
>;

/**
 * Explicitly classifies an effect outcome as externally ambiguous.
 *
 * @example
 * ```ts
 * throw new EffectOutcomeUnknownError("Provider timed out", {
 *   providerOperationId,
 * })
 * ```
 */
export class EffectOutcomeUnknownError extends CruxEffectError {
  /** Provider-specific diagnostic details retained for reconciliation. */
  readonly details?: EffectOutcomeUnknownDetails;

  /**
   * Create an ambiguous-outcome diagnostic.
   *
   * @param message - Concise description of the unknown outcome.
   * @param details - Provider identifiers useful during reconciliation.
   * @param options - Optional original cause.
   */
  constructor(
    message: string,
    details?: EffectOutcomeUnknownDetails,
    options?: { readonly cause?: unknown },
  ) {
    super({
      code: "EFFECT_OUTCOME_AMBIGUOUS",
      message,
      cause: options?.cause,
    });
    this.name = "EffectOutcomeUnknownError";
    this.details = details;
  }
}

/** Input for an incomplete rollback diagnostic. */
export interface RollbackErrorInput {
  /** Aggregate rollback result, when planning completed. */
  readonly result?: RollbackResult;
  /** Recovery-system error tracked before a result existed. */
  readonly recoveryError?: unknown;
  /** Original callback error. */
  readonly cause?: unknown;
  /** Optional concise failure message. */
  readonly message?: string;
}

/**
 * Error thrown when rollback cannot complete honestly.
 *
 * @example
 * ```ts
 * try {
 *   await rollbackOnError(run)
 * } catch (error) {
 *   if (error instanceof RollbackError) {
 *     console.error(error.result?.status)
 *   }
 * }
 * ```
 */
export class RollbackError extends CruxEffectError {
  /** Aggregate rollback result, when available. */
  readonly result?: RollbackResult;
  /** Recovery-system error tracked before a result existed. */
  readonly recoveryError?: unknown;

  /**
   * Create an incomplete rollback diagnostic.
   *
   * @param input - Rollback result, underlying failures, and message.
   */
  constructor(input: RollbackErrorInput = {}) {
    super({
      code: "EFFECT_ROLLBACK_PARTIAL",
      message: input.message ?? "Effect rollback did not complete.",
      cause: input.cause,
    });
    this.name = "RollbackError";
    this.result = input.result;
    this.recoveryError = input.recoveryError;
  }
}

/** Convert a thrown value to a receipt-safe error summary. @internal */
export function summarizeEffectError(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    const code = (error as Error & { readonly code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : error.name,
      message: error.message,
    };
  }
  return { code: "UnknownError", message: String(error) };
}

/** Validate an individual-recovery receipt reference. @internal */
export function assertEffectReceiptRef(
  value: unknown,
): asserts value is EffectReceiptRef {
  if (isRecord(value) && value.kind === "effect.scope") {
    const id =
      typeof value.id === "string" ? value.id : "unknown";
    throw new CruxEffectError({
      code: "EFFECT_SCOPE_NOT_FOUND",
      message: `Effect scope \`${id}\` cannot be recovered as a receipt.`,
    });
  }
  if (
    !isRecord(value) ||
    value.kind !== "effect.receipt" ||
    typeof value.id !== "string" ||
    typeof value.effectId !== "string"
  ) {
    throw effectReceiptNotFound("unknown");
  }
}

/** Create the canonical unknown-receipt diagnostic. @internal */
export function effectReceiptNotFound(id: string): CruxEffectError {
  return new CruxEffectError({
    code: "EFFECT_RECEIPT_NOT_FOUND",
    message: `Effect receipt \`${id}\` was not found.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
