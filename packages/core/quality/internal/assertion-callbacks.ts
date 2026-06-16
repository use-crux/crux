/**
 * Callback runner for Quality assertion phases.
 *
 * The engine has two assertion phases with the same control-flow contract:
 * pre-score `expect` and post-score `assert`. This module owns the replay
 * pass that counts not-evaluated matchers after a hard assertion failure, so
 * the large engine only wires phase-specific contexts.
 *
 * @internal Not exported from `@crux/core/quality` - engine plumbing only.
 * @module
 */

import type { CellAssertionOutcome, CellAssertionPhase } from '../experiment'
import { UncapturedSignalError } from '../expect'
import {
  AssertionFailedError,
  captureSourceRefFromStack,
  createAssertionRecorder,
  type AssertionRecorder,
} from './expect-runtime'

/** One author callback ready to run through the assertion recorder. */
export interface AssertionCallback<TContext> {
  /** Whether this is the pre-score or post-score assertion phase. */
  readonly phase: CellAssertionPhase
  /** Evaluation-level or case-level authoring site. */
  readonly level: CellAssertionOutcome['level']
  /** User-authored callback. */
  readonly fn: (ctx: TContext) => void | Promise<void>
}

/** Result of running a group of assertion callbacks. */
export interface AssertionCallbackRunResult {
  /** Count of matchers skipped by a prior hard failure. */
  readonly notEvaluated: number
  /** Non-assertion callback error, if the callback crashed. */
  readonly error?: {
    readonly message: string
    readonly phase: CellAssertionPhase
    readonly sourceRef?: string
  }
}

/**
 * Run assertion callbacks and record not-evaluated placeholders.
 *
 * Hard assertion failures are data: they do not stop later callbacks from
 * running. Non-assertion errors are execution errors for the cell and stop the
 * current phase.
 */
export async function runAssertionCallbacks<TContext>(input: {
  readonly callbacks: readonly AssertionCallback<TContext>[]
  readonly context: TContext
  readonly recorder: AssertionRecorder
  readonly createCountingContext: (recorder: AssertionRecorder) => TContext
}): Promise<AssertionCallbackRunResult> {
  let notEvaluated = 0

  for (const callback of input.callbacks) {
    input.recorder.phase = callback.phase
    input.recorder.level = callback.level
    const ranBefore = input.recorder.ran
    try {
      await callback.fn(input.context)
    } catch (error) {
      if (error instanceof AssertionFailedError || error instanceof UncapturedSignalError) {
        const ranInCallback = input.recorder.ran - ranBefore
        const countingRecorder = createAssertionRecorder()
        countingRecorder.mode = 'counting'
        countingRecorder.phase = callback.phase
        countingRecorder.level = callback.level
        try {
          await callback.fn(input.createCountingContext(countingRecorder))
        } catch {
          // The counting pass follows the same user code until it reaches a
          // non-assertion dependency or a matcher chain that cannot continue.
        }
        const notEvaluatedOutcomes = countingRecorder.outcomes.slice(ranInCallback).map((outcome) => ({
          level: outcome.level,
          phase: outcome.phase,
          matcher: outcome.matcher,
          soft: outcome.soft,
          ...(outcome.sourceRef !== undefined ? { sourceRef: outcome.sourceRef } : {}),
        }))
        input.recorder.recordNotEvaluated(notEvaluatedOutcomes)
        notEvaluated += notEvaluatedOutcomes.length
        continue
      }

      const sourceRef = error instanceof Error ? captureSourceRefFromStack(error.stack) : undefined
      return {
        notEvaluated,
        error: {
          message: error instanceof Error ? error.message : String(error),
          phase: callback.phase,
          ...(sourceRef !== undefined ? { sourceRef } : {}),
        },
      }
    }
  }

  return { notEvaluated }
}
