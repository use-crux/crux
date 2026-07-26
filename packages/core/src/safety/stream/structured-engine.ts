/**
 * Structured streaming engine for `model.output` boundaries (RFC #173).
 *
 * Wraps the scanner-fed structured occurrence gate in the `SafetyStream`
 * protocol: `feed(wireFragment)` interprets provider wire-JSON fragments through
 * scanner → manifest decode → occurrence gating → monotonic release cursor,
 * producing the object-gated canonical text. That canonical text is then piped
 * through the shared text-occurrence engine so `model.output.text` guards observe
 * the **canonical serialized text** — never provider wire text or lowering
 * sentinels — evaluated per canonical released delta (the adaptive default;
 * `.complete()` buffers). `finish()` seals `{ text, parsed, pending }`, where a
 * text-boundary rewrite resynchronizes the object from the accepted text so the
 * exposed text, canonical `z.input`, and final object share one representation.
 * The `model.output` composite and constraints stay with the completion terminal.
 *
 * Identical on the native and SDK routes: both feed wire JSON to this stream.
 *
 * @module
 */

import type { GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { SafetyProtocolEvent, SafetyStream, SafetyStreamDirective, SafetyStreamSeal } from '../session'
import type { ReleaseGateKind } from './gates'
import type { JsonSchemaObject, StructuredOutputDecodeManifest } from '../../adapter/structured-output'
import type { Constraint, ConstraintContext } from '../constraint/types'
import { createStructuredStreamGate } from './structured-stream-gate'
import { createTextReplayEngine } from './text-replay'
import { constraintOccurrenceEntries } from '../constraint/occurrences'
import { subjectFingerprint } from '../constraint/fingerprint'
import { StreamConstraintRejection } from '../constraint/settlement'
import type { ConstraintOccurrenceSettlement } from '../constraint/settlement'
import { observeConstraintCheck } from '../constraint/runner'

export interface CreateStructuredSafetyStreamOptions {
  /** Object (`model.output.object`) bindings for this call. */
  readonly objectBindings: readonly GuardrailBinding[]
  /** Text (`model.output.text`) bindings, gated over the canonical serialized text. */
  readonly textBindings: readonly GuardrailBinding[]
  /** `assert` constraints that commit the attempt (hold release until resolved). */
  readonly assertConstraints?: readonly Constraint[]
  readonly constraintContext?: ConstraintContext
  /**
   * Whether any downstream stage besides the text engine can still change the
   * represented JSON — a composite `model.output` guard or an output-media guard.
   * Such a stage makes an object assertion provisional exactly as a text guard does.
   */
  readonly downstreamMutators?: boolean
  /** Terminal guard context (with `stream.last = true`) for occurrence gating. */
  readonly guardContext: GuardrailContext
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void
  /** Compiler-owned canonical schema for per-occurrence structural validation. */
  readonly canonicalSchema?: JsonSchemaObject
  /** Reversible decode manifest; sentinel deletions apply before path selection. */
  readonly manifest?: StructuredOutputDecodeManifest
  readonly transcript: SafetyProtocolEvent[]
}

/** Adapt the structured occurrence gate to the `SafetyStream` protocol. */
export function createStructuredSafetyStream(options: CreateStructuredSafetyStreamOptions): SafetyStream {
  const gate = createStructuredStreamGate({
    objectBindings: options.objectBindings,
    guardContext: options.guardContext,
    appendGuardrailAudit: options.appendGuardrailAudit,
    ...(options.manifest ? { manifest: options.manifest } : {}),
    ...(options.canonicalSchema ? { canonicalSchema: options.canonicalSchema } : {}),
    ...(options.assertConstraints && options.assertConstraints.length > 0 && options.constraintContext
      ? { assertConstraints: options.assertConstraints, constraintContext: options.constraintContext }
      : {}),
  })
  // `model.output.text` guards run over the object-gated canonical text, per
  // canonical released delta, through the same engine text streams use.
  const textEngine =
    options.textBindings.length > 0
      ? createTextReplayEngine({
          textBindings: options.textBindings,
          mode: 'stream',
          guardContext: () => options.guardContext,
          appendGuardrailAudit: options.appendGuardrailAudit,
        })
      : undefined

  // Governing rule (RFC #173): no occurrence may unlock bytes until every downstream
  // transformation capable of changing that occurrence has completed. An object/path
  // assertion that passes inside `gate.feed()` is only PROVISIONAL when a downstream text
  // or composite guard can still rewrite the represented JSON — it cannot authorize
  // release. Object-only pipelines have no such downstream stage and keep progressive
  // release; the mixed case deliberately trades early unlock for correctness.
  // Contract 06, publication law 3: a composite `model.output` or output-media guard
  // defers affected publication INDEPENDENTLY of constraints — it can rewrite or block
  // the represented value at the terminal stage, so nothing may publish before it runs.
  // A text guard only makes an object assertion provisional, so that half still requires
  // an assert to be present.
  const hasAssert =
    options.assertConstraints !== undefined && options.assertConstraints.length > 0
  const deferCommitment =
    options.downstreamMutators === true || (textEngine !== undefined && hasAssert)
  const deferralReason: ReleaseGateKind =
    options.downstreamMutators === true ? 'guardrail' : 'serialization'

  async function feed(chunk: string): Promise<SafetyStreamDirective> {
    const canonical = await gate.feed(chunk)
    const content = textEngine ? await textEngine.feed(canonical) : canonical
    if (deferCommitment && content.length > 0) {
      // Cleared by the object gate and the text engine, but still uncommitted: a later
      // stage could invalidate what cleared it. Hold to EOF, where the final canonical
      // occurrence is compared against the provisional settlement.
      //
      // The reason names the stage a user can act on: an unresolved terminal
      // composite/output-media GUARDRAIL when that is what defers publication, and the
      // provisional object serialization when a text rewrite is what makes an assertion
      // non-final.
      held += content
      options.transcript.push({ t: 'stream.chunk', directive: 'hold', bufferedBy: deferralReason })
      return { kind: 'hold', bufferedBy: deferralReason }
    }
    if (content.length === 0) {
      // The highest-precedence active gate: the commit gate's own reason, else a
      // guardrail hold when the gate released canonical bytes the text engine held.
      const bufferedBy = gate.heldBy() ?? (canonical.length > 0 ? 'guardrail' : undefined)
      options.transcript.push({ t: 'stream.chunk', directive: 'hold', ...(bufferedBy ? { bufferedBy } : {}) })
      return { kind: 'hold', ...(bufferedBy ? { bufferedBy } : {}) }
    }
    options.transcript.push({ t: 'stream.chunk', directive: 'emit' })
    return { kind: 'emit', content }
  }

  // Content cleared downstream but withheld while the attempt is uncommitted.
  let held = ''

  async function finish(): Promise<SafetyStreamSeal> {
    const seal = await gate.finish()
    options.transcript.push({ t: 'stream.finish' })
    // Occurrence-precise settlement recorded while gating (attemptId bound by the
    // adapter). Absent when no asserts were attached.
    const gateSettlement = gate.settlement()
    const settlement: { settlement?: SafetyStreamSeal['settlement'] } =
      gateSettlement.settled.length > 0 || gateSettlement.audit.length > 0
        ? { settlement: { attemptId: '', settled: gateSettlement.settled, audit: gateSettlement.audit } }
        : {}
    // Gate the final canonical delta, then drain the text engine. A text rewrite
    // makes the exposed text diverge from the object-gated serialization, so the
    // object resynchronizes from the accepted text (invalid JSON fails closed).
    //
    // With no text engine there is nothing to drain, but the tail below still runs:
    // `downstreamMutators` (a composite `model.output` or media guard) can defer
    // commitment WITHOUT any text binding, and returning early here dropped every
    // withheld byte and skipped the recheck entirely.
    const finalText = textEngine ? undefined : seal.text
    const tailReleased = textEngine ? await textEngine.feed(seal.pending) : ''
    const sealed = textEngine
      ? await textEngine.finish()
      : { text: seal.text, pending: seal.pending }
    const parsed =
      finalText !== undefined || sealed.text === seal.text
        ? seal.parsed
        : JSON.parse(sealed.text)
    // Everything withheld under deferred commitment is released here, after final text
    // processing and resynchronization. The settlement travels with the seal as
    // PROVISIONAL evidence: the terminal constraint pass re-checks any occurrence whose
    // canonical value changed (fingerprint mismatch) and reuses the rest, so a rewrite
    // that invalidated an assertion cannot slip through.
    // Re-evaluate BEFORE releasing anything. Any occurrence whose canonical value the
    // downstream rewrite changed loses its provisional settlement and is checked against
    // the final value; a failure raises the same non-terminal rejection the live gate
    // raises, so the attempt is discarded and retried with zero bytes published.
    if (deferCommitment && options.assertConstraints && options.constraintContext) {
      const installed = await recheckInvalidatedOccurrences({
        constraints: options.assertConstraints,
        settled: gateSettlement.settled,
        parsed,
        text: sealed.text,
        context: options.constraintContext,
      })
      if (installed.length > 0) {
        settlement.settlement = {
          attemptId: '',
          settled: installed,
          audit: gateSettlement.audit,
        }
      }
    }
    const pending = held + tailReleased + sealed.pending
    held = ''
    return { text: sealed.text, parsed, pending, ...settlement }
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

/**
 * Re-evaluate occurrences whose canonical value a downstream stage changed.
 *
 * @remarks
 * Runs through the shared observed evaluator, so a recheck is indistinguishable from any
 * other constraint evaluation: callbacks receive a proper run context (`ctx.findings.add`
 * works), and the usual span, audit and event records are produced. The evaluator applies
 * the provisional settlement itself, so an occurrence whose value is unchanged is not
 * re-run.
 *
 * Returns the settlement to INSTALL on the seal: occurrences that passed here are
 * re-fingerprinted against their final values, so completion sees evidence describing
 * what will actually be published and does not evaluate them a third time.
 */
async function recheckInvalidatedOccurrences(options: {
  readonly constraints: readonly Constraint[]
  readonly settled: readonly ConstraintOccurrenceSettlement[]
  readonly parsed: unknown
  readonly text: string
  readonly context: ConstraintContext
}): Promise<readonly ConstraintOccurrenceSettlement[]> {
  const output = { text: options.text, parsed: options.parsed }
  const installed: ConstraintOccurrenceSettlement[] = []
  for (const constraint of options.constraints) {
    const observed = await observeConstraintCheck(constraint, output, options.context, options.settled)
    if (!observed.result.pass) {
      throw new StreamConstraintRejection({
        failures: [
          {
            name: constraint.id,
            ...(constraint.category !== undefined ? { category: constraint.category } : {}),
            severity: constraint.severity,
            feedback: observed.result.feedback,
            maxRetries: constraint.maxRetries,
          },
        ],
        text: options.text,
        settlement: {
          attemptId: '',
          settled: [],
          audit: [
            {
              constraint: constraint.id,
              ...(constraint.category !== undefined ? { category: constraint.category } : {}),
              severity: constraint.severity,
              pass: false,
              feedback: observed.result.feedback,
              attempts: 1,
              durationMs: observed.durationMs,
            },
          ],
        },
      })
    }
    // Passed against the FINAL value: re-fingerprint every occurrence so completion
    // reuses this evidence instead of evaluating the constraint again.
    for (const entry of constraintOccurrenceEntries(constraint.on, output)) {
      installed.push({
        constraint: constraint.id,
        occurrence: entry.occurrence,
        subjectFingerprint: subjectFingerprint(entry.subject),
        pass: true,
        closed: true,
      })
    }
  }
  return installed
}
