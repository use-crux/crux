import type { Message } from '../../generation/messages'
import type { Constraint, ConstraintAudit, ConstraintContext } from '../constraint/types'
import { StreamHoldLimitError } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext, GuardrailRunResult } from '../guardrail/types'
import { validateGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import type { SafetyProtocolEvent, SafetyStream, SafetyStreamDirective, SafetyStreamSeal } from '../session'
import { auditDisabledStreamGuards, recordStreamChunkAction } from './audit'
import { runFinalBoundaryGuard } from './boundary'
import { runFinalStreamConstraints, runStreamChunkConstraints } from './constraints'
import { heldMs, streamGuardDecision } from './decision'
import { segmenterFor, streamMaxHoldChars, streamOnHoldLimit, type StreamSegment } from './segment'

export interface CreateSafetyStreamOptions {
  readonly outputBindings: readonly GuardrailBinding[]
  readonly constraints: readonly Constraint[]
  readonly messages: () => readonly Message[]
  readonly guardContext: () => GuardrailContext
  readonly constraintContext: () => ConstraintContext
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void
  readonly getConstraintAudit: () => ConstraintAudit | undefined
  readonly setConstraintAudit: (audit: ConstraintAudit) => void
  readonly transcript: SafetyProtocolEvent[]
}

interface StreamStage {
  readonly binding: GuardrailBinding
  readonly segment: StreamSegment
  readonly maxHoldChars: number
  readonly onHoldLimit: 'block' | 'release'
  buffer: string
  heldStartedAt: number | undefined
}

/**
 * Creates the gated-stage stream engine used by `Safety.openStream()`.
 *
 * Each stage consumes the cleared output of the previous stage. Text exits the
 * final stage only after every enforcing stream guard has allowed, rewritten,
 * or warned on that segment.
 */
export function createSafetyStream(options: CreateSafetyStreamOptions): SafetyStream {
  const outputBindings = options.outputBindings
  const disabledBindings = outputBindings.filter((binding) => binding.stream === false)
  const finalTextBindings = outputBindings.filter((binding) => binding.stream === 'final')
  const finalBoundaryBindings = outputBindings.filter((binding) => binding.boundary.id === 'model.output.object')
  const stagedBindings = outputBindings.filter(
    (binding) =>
      !disabledBindings.includes(binding) &&
      !finalTextBindings.includes(binding) &&
      !finalBoundaryBindings.includes(binding) &&
      (binding.boundary.id === 'model.output.text' || binding.boundary.id === 'model.output'),
  )
  const chunkConstraints = options.constraints.filter((constraint) => constraint.onChunk)

  const stages: StreamStage[] = stagedBindings.map((binding) => ({
    binding,
    segment: segmenterFor(binding.stream),
    maxHoldChars: streamMaxHoldChars(binding.stream),
    onHoldLimit: streamOnHoldLimit(binding.stream),
    buffer: '',
    heldStartedAt: undefined,
  }))

  let sourceText = ''
  let releasedText = ''
  let disabledAudited = false

  async function feed(chunk: string): Promise<SafetyStreamDirective> {
    auditDisabled()
    sourceText += chunk

    const content = await runStages(chunk, false)
    if (content.length === 0) {
      options.transcript.push({ t: 'stream.chunk', directive: 'hold' })
      return { kind: 'hold' }
    }

    await runStreamChunkConstraints({
      constraints: chunkConstraints,
      content,
      releasedText,
      context: options.constraintContext(),
      audit: options.getConstraintAudit(),
    })

    releasedText += content
    options.transcript.push({ t: 'stream.chunk', directive: 'emit' })
    return { kind: 'emit', content }
  }

  async function finish(): Promise<SafetyStreamSeal> {
    auditDisabled()
    let pending = ''
    let text = releasedText

    pending = await runStages('', true)
    text += pending

    if (finalTextBindings.length > 0) {
      const pipeline = createGuardrailPipeline(finalTextBindings)
      const result = await pipeline.runOutput(text, streamContext(true, 0, 0))
      options.appendGuardrailAudit(result.audit)
      text = result.content
      pending = text.slice(releasedText.length)
    }

    for (const binding of finalBoundaryBindings) {
      await runFinalBoundaryGuard(binding, text, streamContext(true, 0, 0))
    }

    const finalConstraintAudit = await runFinalStreamConstraints({
      constraints: options.constraints,
      text,
      context: options.constraintContext(),
      audit: options.getConstraintAudit(),
    })
    if (finalConstraintAudit) options.setConstraintAudit(finalConstraintAudit)

    options.transcript.push({ t: 'stream.finish' })
    return { text, parsed: undefined, pending }
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

  async function runStages(input: string, last: boolean): Promise<string> {
    let current = input
    for (const stage of stages) {
      stage.buffer += current
      current = await drainStage(stage, last)
      if (current.length === 0 && stage.buffer.length > 0) break
    }
    return current
  }

  async function drainStage(stage: StreamStage, last: boolean): Promise<string> {
    let output = ''
    for (;;) {
      if (stage.buffer.length === 0) {
        stage.heldStartedAt = undefined
        return output
      }

      const segment = last ? stage.buffer : stage.segment(stage.buffer, false)
      if (segment === null || segment.length === 0) {
        stage.heldStartedAt ??= performance.now()
        enforceStageHoldLimit(stage)
        return output
      }
      if (!stage.buffer.startsWith(segment)) {
        throw new StreamHoldLimitError({
          message: `Stream segmenter for "${stage.binding.policy.id}" returned non-prefix content.`,
          policyId: stage.binding.policy.id,
          heldChars: stage.buffer.length,
          heldMs: heldMs(stage),
        })
      }

      stage.buffer = stage.buffer.slice(segment.length)
      const result = await runStageGuard(stage, segment, last)
      const reportOnly = stage.binding.mode === 'report'

      switch (result.action) {
        case 'allow':
          stage.heldStartedAt = undefined
          output += segment
          break
        case 'warn':
          stage.heldStartedAt = undefined
          recordStreamChunkAction(options.appendGuardrailAudit, stage.binding, result, result.reason)
          output += segment
          break
        case 'rewrite':
          stage.heldStartedAt = undefined
          recordStreamChunkAction(options.appendGuardrailAudit, stage.binding, result)
          output += reportOnly ? segment : stringifyGuardrailValue(result.value)
          break
        case 'block':
          recordStreamChunkAction(options.appendGuardrailAudit, stage.binding, result, result.reason, {
            blocked: !reportOnly,
          })
          if (reportOnly) {
            stage.heldStartedAt = undefined
            output += segment
            break
          }
          throw new GuardrailBlockedError({
            guardrailId: stage.binding.policy.id,
            phase: 'output',
            reason: result.reason,
            decisions: [streamGuardDecision(stage.binding, result, segment)],
          })
        case 'hold':
          if (reportOnly) {
            stage.heldStartedAt = undefined
            output += segment
            break
          }
          stage.buffer = segment + stage.buffer
          stage.heldStartedAt ??= performance.now()
          if (last) {
            throw new StreamHoldLimitError({
              message: `Stream guardrail "${stage.binding.policy.id}" held content at end of stream.`,
              policyId: stage.binding.policy.id,
              heldChars: stage.buffer.length,
              heldMs: heldMs(stage),
            })
          }
          enforceStageHoldLimit(stage)
          return output
      }
    }
  }

  async function runStageGuard(stage: StreamStage, segment: string, last: boolean): Promise<GuardrailRunResult<unknown>> {
    const context = streamContext(last, stage.buffer.length + segment.length, heldMs(stage))
    const guard = stage.binding.policy
    const boundary = stage.binding.boundary
    return validateGuardrailRunResult(
      await guard.run(segment as never, {
        policy: { id: guard.id, mode: stage.binding.mode },
        boundary: { id: boundary.id as never, kind: boundary.id as never },
        prompt: { id: context.promptId },
        model: { id: context.model },
        trace: { id: context.traceId },
        attempt: { index: 0, kind: 'initial' },
        metadata: context.metadata,
        findings: { add() {} },
        stream: context.stream,
        ...(boundary.path ? { path: boundary.path } : {}),
      } as never),
      {
        streaming: true,
        last,
        policyId: guard.id,
        boundary: boundary.id,
      },
    )
  }

  function streamContext(
    last: boolean,
    heldChars: number,
    heldMsValue: number,
  ): GuardrailContext & {
    readonly stream: {
      readonly segment: true
      readonly last: boolean
      readonly heldChars: number
      readonly heldMs: number
    }
  } {
    return {
      ...options.guardContext(),
      messages: options.messages(),
      stream: { segment: true, last, heldChars, heldMs: heldMsValue },
    }
  }

  function auditDisabled(): void {
    if (disabledAudited) return
    disabledAudited = true
    auditDisabledStreamGuards(disabledBindings, options.appendGuardrailAudit)
  }

  function enforceStageHoldLimit(stage: StreamStage): void {
    if (stage.buffer.length <= stage.maxHoldChars) return
    if (stage.onHoldLimit === 'release') return
    throw new StreamHoldLimitError({
      message: `Stream guardrail "${stage.binding.policy.id}" exceeded maxHold.`,
      policyId: stage.binding.policy.id,
      heldChars: stage.buffer.length,
      heldMs: heldMs(stage),
    })
  }

  return { feed, finish, transform }
}

function stringifyGuardrailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
