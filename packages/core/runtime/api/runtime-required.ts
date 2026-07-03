/**
 * `RUNTIME_REQUIRED` diagnostic factory.
 *
 * Runtime-bound APIs use this helper when no Runtime Engine has been
 * configured, so each API reports the same actionable fallback and setup path.
 *
 * @module
 */

import { createRuntimeError } from '../engine/errors'
import type { CruxRuntimeError } from '../engine/errors'

/** Options for rendering a missing-runtime diagnostic. */
export interface RuntimeRequiredErrorOptions {
  /** API call that requires a runtime, for example `flow.waitFor()`. */
  readonly api: string
}

/** Runtime diagnostic whose code is known to be `RUNTIME_REQUIRED`. */
export type RuntimeRequiredError = CruxRuntimeError & {
  readonly code: 'RUNTIME_REQUIRED'
}

/** Create the standard `RUNTIME_REQUIRED` diagnostic for a runtime-bound API. */
export function runtimeRequiredError(
  options: RuntimeRequiredErrorOptions,
): RuntimeRequiredError {
  return createRuntimeError({
    code: 'RUNTIME_REQUIRED',
    whatFailed: `${options.api} requires a Crux runtime engine.`,
    why: 'Crux must persist durable work, waiters, timers, and wake delivery before the current process can exit.',
    whatStillWorks: [
      'This flow can still use flow.suspend() with manual resume:',
      '  await reviewFlow.signal(flowId, "approval", payload)',
      '  await reviewFlow.run({ resume: flowId })',
    ].join('\n'),
    nextStep: [
      'To enable durable auto-resume, configure runtime in crux.config.ts:',
      '  runtime: serverless({ store: postgres(), wake: qstash() })',
    ].join('\n'),
  }) as RuntimeRequiredError
}
