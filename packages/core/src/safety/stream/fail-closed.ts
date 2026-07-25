/**
 * Standalone fail-closed translation (RFC #173, Phase 15).
 *
 * A live commit gate raises the internal, non-terminal {@link StreamConstraintRejection}
 * on an `assert` failure. A standalone `Safety.openStream()` has no regeneration
 * authority, so this wrapper translates that rejection into the single public
 * terminal {@link ConstraintViolationError}. The adapter routes instead consume the
 * non-terminal rejection through the shared stream-attempt coordinator (which
 * retries when eligible), so they do NOT wrap with this.
 *
 * @module
 */

import type { SafetyStream, SafetyStreamDirective, SafetyStreamSeal } from '../session'
import { ConstraintViolationError } from '../constraint/errors'
import { isStreamConstraintRejection } from '../constraint/settlement'

/** Wrap a stream so a non-terminal assert rejection surfaces as the public terminal error. */
export function failClosedOnRejection(stream: SafetyStream): SafetyStream {
  const translate = (error: unknown): never => {
    if (isStreamConstraintRejection(error)) {
      throw new ConstraintViolationError({
        failedConstraints: error.failures.map((failure) => ({ name: failure.name, feedback: failure.feedback })),
        audit: { entries: error.settlement.audit, allPassed: false, suggestFallback: false },
        lastOutput: error.text,
        totalAttempts: 1,
      })
    }
    throw error
  }

  const feed = (chunk: string): Promise<SafetyStreamDirective> => stream.feed(chunk).catch(translate)
  const finish = (): Promise<SafetyStreamSeal> => stream.finish().catch(translate)

  return {
    feed,
    finish,
    transform() {
      return new TransformStream<string, string>({
        async transform(chunk, controller) {
          const directive = await feed(chunk)
          if (directive.kind === 'emit' && directive.content.length > 0) controller.enqueue(directive.content)
        },
        async flush(controller) {
          const seal = await finish()
          if (seal.pending.length > 0) controller.enqueue(seal.pending)
        },
      })
    },
  }
}
