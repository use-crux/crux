/**
 * Flow-specific retry guards.
 *
 * `flow.step()` uses the shared retry utility for ordinary user-code
 * failures, but flow lifecycle errors are control-flow signals for the
 * executor. They must escape retry and fallback handling so the executor can
 * persist the correct flow state.
 *
 * @module
 */

import { isNonRetryableCruxPolicyError } from '../generation/retry'
import type { RetryOptions } from '../generation/retry'
import { FlowCancelledError, FlowExpiredError, FlowSuspendedError } from './types'

/** Control-flow errors that drive the flow lifecycle state machine. */
export type FlowLifecycleControlError = FlowSuspendedError | FlowCancelledError | FlowExpiredError

/**
 * Returns true for errors that represent expected flow lifecycle transitions.
 *
 * These are not step failures. `executeFlow()` catches them outside the step
 * retry layer and converts them into `FlowResult` lifecycle outcomes.
 *
 * @param error - Unknown error thrown while executing a flow step.
 */
export function isFlowLifecycleControlError(error: unknown): error is FlowLifecycleControlError {
  return error instanceof FlowSuspendedError || error instanceof FlowCancelledError || error instanceof FlowExpiredError
}

/**
 * Prepare retry options for a `flow.step()` call.
 *
 * The returned options preserve the caller's retry policy for ordinary errors
 * and the shared Crux policy-terminal errors, while forcing flow lifecycle
 * control errors to bypass both retry attempts and fallback execution.
 *
 * @param options - User-provided step retry and fallback options.
 * @returns Retry options safe for the flow step boundary.
 */
export function flowStepRetryOptions(options?: RetryOptions): RetryOptions | undefined {
  if (!options) return undefined

  return {
    ...options,
    shouldRetry(error, context) {
      if (isFlowLifecycleControlError(error)) return false
      return options.shouldRetry?.(error, context) ?? !isNonRetryableCruxPolicyError(error)
    },
  }
}
