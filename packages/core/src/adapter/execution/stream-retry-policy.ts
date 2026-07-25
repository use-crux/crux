/**
 * Shared stream retry policy (RFC #173, Phase 15).
 *
 * The single source of truth for whether a rejected stream attempt may be retried and,
 * when it may not, which typed public error terminates the logical operation. Both the
 * native coordinator (which owns its provider loop) and the loop-owning SDK plan consume
 * this, so retry semantics cannot drift between routes and no runtime re-implements
 * policy.
 *
 * Deterministic ordering: the typed cause that rejects the CURRENT attempt and cannot
 * obtain another shared step decides the terminal error — validation →
 * {@link ValidationExhaustedError}, constraint → {@link ConstraintViolationError}. Never a
 * combined error.
 *
 * @module
 */

import type { Message } from "../../generation/messages";
import type { ConstraintAuditEntry, ConstraintFailure } from "../../safety/constraint/types";
import { isStreamConstraintRejection } from "../../safety/constraint/settlement";
import { ConstraintViolationError } from "../../safety/constraint/errors";
import {
  ValidationExhaustedError,
  type ValidationRetryOptions,
} from "../../generation/validation-retry";
import { formatValidationFeedback } from "../policy/validation-retry";
import { isStreamValidationRejection } from "./stream-rejection";
import type { StreamAttemptCause } from "./stream-attempt";

export interface StreamRetryPolicyOptions {
  /** Shared logical-operation provider-call budget (same as generate). */
  readonly maxSteps: number;
  /** Current shared step count (validation + constraint retries share it). */
  readonly steps: () => number;
  /** Build corrective messages from a rejected attempt's constraint failures. */
  readonly formatFeedback: (failures: readonly ConstraintFailure[]) => readonly Message[];
  /** Validation-retry policy, when a positive-retry validation gate is configured. */
  readonly validationRetry?: ValidationRetryOptions;
  readonly promptId?: string;
  /** Announce a constraint retry (next attempt index, sanitized failed ids). */
  readonly onRetry?: (attemptIndex: number, failedIds: readonly string[]) => void;
}

/** A granted retry: what the next attempt should send and why it exists. */
export interface StreamRetryGrant {
  readonly corrective: readonly Message[];
  readonly cause: StreamAttemptCause;
  /** Sanitized ids of the policies that discarded the previous attempt, when any. */
  readonly failedPolicies?: readonly string[];
}

export interface StreamRetryPolicy {
  /**
   * Decide what happens after a rejection. Returns the retry grant when another
   * attempt is allowed; THROWS the typed public terminal error when it is not.
   * Rethrows anything that is not a recognized stream rejection.
   */
  onRejection(error: unknown, attemptIndex: number): StreamRetryGrant;
  /**
   * Translate a rejection into its typed public terminal error WITHOUT granting a retry.
   *
   * Used when retrying would be unsafe for a reason outside the retry policy itself —
   * unknown step consumption, or settled tool rounds that cannot be resumed without
   * re-executing side effects. The caller still gets `ConstraintViolationError` or
   * `ValidationExhaustedError`, never the internal non-terminal cause and never a
   * combined error.
   */
  terminal(error: unknown, attemptIndex: number): never;
  /** Whether the shared budget can still afford another provider call. */
  canAffordAttempt(): boolean;
  /** Audit accumulated from DISCARDED attempts (never merged into the accepted settlement). */
  cumulativeAudit(): readonly ConstraintAuditEntry[];
  /** The terminal error when the shared budget is exhausted with no accepted attempt. */
  budgetExhausted(attemptIndex: number): ConstraintViolationError;
}

/** Create the shared retry policy for one logical stream operation. */
export function createStreamRetryPolicy(
  options: StreamRetryPolicyOptions,
): StreamRetryPolicy {
  const retriesByConstraint = new Map<string, number>();
  const audit: ConstraintAuditEntry[] = [];
  const maxValidationRetries = options.validationRetry?.maxRetries ?? 0;
  let validationRetries = 0;

  const canAffordAttempt = () => options.steps() < options.maxSteps;

  return {
    canAffordAttempt,
    cumulativeAudit: () => audit,

    budgetExhausted(attemptIndex) {
      return new ConstraintViolationError({
        failedConstraints: [],
        audit: { entries: audit, allPassed: false, suggestFallback: false },
        lastOutput: "",
        totalAttempts: attemptIndex,
      });
    },

    terminal(error, attemptIndex): never {
      if (isStreamValidationRejection(error)) {
        options.validationRetry?.onExhausted?.(validationRetries, error.error);
        throw new ValidationExhaustedError({
          lastRawOutput: error.text,
          zodErrors: error.error,
          attempts: validationRetries,
          maxAttempts: maxValidationRetries,
          promptId: options.promptId ?? "unknown",
        });
      }
      if (!isStreamConstraintRejection(error)) throw error;
      audit.push(...error.settlement.audit);
      throw new ConstraintViolationError({
        failedConstraints: error.failures.map((failure) => ({
          name: failure.name,
          feedback: failure.feedback,
        })),
        audit: { entries: audit, allPassed: false, suggestFallback: false },
        lastOutput: error.text,
        totalAttempts: attemptIndex + 1,
      });
    },

    onRejection(error, attemptIndex) {
      if (isStreamValidationRejection(error)) {
        if (!canAffordAttempt() || validationRetries >= maxValidationRetries) {
          options.validationRetry?.onExhausted?.(validationRetries, error.error);
          throw new ValidationExhaustedError({
            lastRawOutput: error.text,
            zodErrors: error.error,
            attempts: validationRetries,
            maxAttempts: maxValidationRetries,
            promptId: options.promptId ?? "unknown",
          });
        }
        validationRetries += 1;
        options.validationRetry?.onRetry?.(validationRetries, error.error);
        return {
          corrective: [
            { role: "user", content: formatValidationFeedback(error.text, error.error) },
          ],
          cause: "validation-retry",
        };
      }

      if (!isStreamConstraintRejection(error)) throw error;
      audit.push(...error.settlement.audit);
      const eligible = error.failures.some(
        (failure) => (retriesByConstraint.get(failure.name) ?? 0) < failure.maxRetries,
      );
      if (!canAffordAttempt() || !eligible) {
        throw new ConstraintViolationError({
          failedConstraints: error.failures.map((failure) => ({
            name: failure.name,
            feedback: failure.feedback,
          })),
          audit: { entries: audit, allPassed: false, suggestFallback: false },
          lastOutput: error.text,
          totalAttempts: attemptIndex + 1,
        });
      }
      for (const failure of error.failures) {
        retriesByConstraint.set(
          failure.name,
          (retriesByConstraint.get(failure.name) ?? 0) + 1,
        );
      }
      const failedPolicies = error.failures.map((failure) => failure.name);
      options.onRetry?.(attemptIndex + 1, failedPolicies);
      return {
        corrective: options.formatFeedback(error.failures),
        cause: "constraint-retry",
        failedPolicies,
      };
    },
  };
}
