import type { Message } from '../../generation/messages'
import type { Constraint, ConstraintAudit, ConstraintContext } from '../constraint/types'
import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { SafetyProtocolEvent, SafetyStream, SafetyStreamDirective, SafetyStreamSeal } from '../session'
import { runFinalStreamConstraints } from './constraints'
import { observeConstraintCheck } from '../constraint/runner'
import { StreamConstraintRejection } from '../constraint/settlement'
import type { ConstraintAuditEntry } from '../constraint/types'
import { createTextReplayEngine } from './text-replay'

export interface CreateSafetyStreamOptions {
  readonly outputBindings: readonly GuardrailBinding[]
  /** Enforce-mode constraints; an `assert` among them commits (gates) the attempt. */
  readonly constraints: readonly Constraint[]
  /** Report-mode constraints — always report-only, never gate release. */
  readonly reportConstraints: readonly Constraint[]
  readonly messages: () => readonly Message[]
  readonly guardContext: () => GuardrailContext
  readonly constraintContext: () => ConstraintContext
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void
  readonly getConstraintAudit: () => ConstraintAudit | undefined
  readonly setConstraintAudit: (audit: ConstraintAudit) => void
  readonly transcript: SafetyProtocolEvent[]
}

/**
 * Creates the gated stream engine used by `Safety.openStream()`.
 *
 * Text units are gated by the shared text-occurrence replay engine (canonical
 * deltas + EOF); object boundaries and transactional constraints are evaluated at
 * finalization. Text exits only after every enforcing unit guard has allowed,
 * rewritten, or warned on it.
 */
export function createSafetyStream(options: CreateSafetyStreamOptions): SafetyStream {
  const textBindings = options.outputBindings.filter(
    (binding) => binding.boundary.id === 'model.output.text' || binding.boundary.id === 'model.output',
  )
  const textEngine = createTextReplayEngine({
    textBindings,
    mode: 'stream',
    guardContext: () => ({ ...options.guardContext(), messages: options.messages() }),
    appendGuardrailAudit: options.appendGuardrailAudit,
  })

  // `assert` constraints commit the whole attempt: a text/composite assert resolves
  // only at EOF, so while any is present all guarded output is buffered to
  // completion (`bufferedBy: 'constraint'`); `suggest` constraints stay report-only.
  const assertConstraints = options.constraints.filter((constraint) => constraint.severity === 'assert')
  const reportOnlyConstraints = [
    ...options.constraints.filter((constraint) => constraint.severity !== 'assert'),
    ...options.reportConstraints,
  ]
  let heldByAssert = ''

  async function feed(chunk: string): Promise<SafetyStreamDirective> {
    const content = await textEngine.feed(chunk)
    if (assertConstraints.length > 0) {
      heldByAssert += content
      options.transcript.push({ t: 'stream.chunk', directive: 'hold', bufferedBy: 'constraint' })
      return { kind: 'hold', bufferedBy: 'constraint' }
    }
    if (content.length === 0) {
      options.transcript.push({ t: 'stream.chunk', directive: 'hold' })
      return { kind: 'hold' }
    }
    options.transcript.push({ t: 'stream.chunk', directive: 'emit' })
    return { kind: 'emit', content }
  }

  async function finish(): Promise<SafetyStreamSeal> {
    const { text, pending } = await textEngine.finish()
    heldByAssert += pending

    // Run the attempt-committing asserts over the complete guarded text. A failure
    // fails the standalone stream closed (no regeneration authority here); an
    // adapter stream retries via its own loop before finishing.
    if (assertConstraints.length > 0) await commitAsserts(text)

    // `suggest`/report-only constraints never gate release — record the audit.
    const finalConstraintAudit = await runFinalStreamConstraints({
      constraints: reportOnlyConstraints,
      text,
      context: options.constraintContext(),
      audit: options.getConstraintAudit(),
    })
    if (finalConstraintAudit) options.setConstraintAudit(finalConstraintAudit)

    options.transcript.push({ t: 'stream.finish' })
    // With an assert gate, nothing released during `feed`; the whole guarded text
    // is the pending tail released now that every assert has passed.
    return { text, parsed: undefined, pending: assertConstraints.length > 0 ? heldByAssert : pending }
  }

  /** Evaluate each assert over the final text; raise a non-terminal rejection on failure. */
  async function commitAsserts(text: string): Promise<void> {
    for (const constraint of assertConstraints) {
      const check = await observeConstraintCheck(constraint, { text, parsed: undefined }, options.constraintContext())
      if (check.result.pass) continue
      const feedback = check.result.pass ? '' : check.result.feedback
      const entry: ConstraintAuditEntry = {
        constraint: constraint.id,
        ...(constraint.category !== undefined ? { category: constraint.category } : {}),
        severity: constraint.severity,
        pass: false,
        feedback,
        attempts: 1,
        durationMs: check.durationMs,
      }
      // Non-terminal: the coordinator retries; a standalone stream translates it.
      throw new StreamConstraintRejection({
        failures: [
          {
            name: constraint.id,
            ...(constraint.category !== undefined ? { category: constraint.category } : {}),
            severity: constraint.severity,
            feedback,
            maxRetries: constraint.maxRetries,
          },
        ],
        text,
        settlement: { attemptId: '', settled: [{ constraint: constraint.id, occurrence: [], subjectFingerprint: '', pass: false, closed: true }], audit: [entry] },
      })
    }
  }

  function transform(): TransformStream<string, string> {
    return new TransformStream<string, string>({
      async transform(chunk, controller) {
        const directive = await feed(chunk)
        if (directive.kind === 'emit' && directive.content.length > 0) {
          controller.enqueue(directive.content)
        }
      },
      async flush(controller) {
        const seal = await finish()
        if (seal.pending.length > 0) controller.enqueue(seal.pending)
      },
    })
  }

  return { feed, finish, transform }
}
