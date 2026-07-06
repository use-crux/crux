import type { Message } from '../../generation/messages'
import type { Constraint, ConstraintAudit, ConstraintContext } from '../constraint/types'
import { StreamHoldLimitError } from '../errors'
import { GuardrailBlockedError } from '../guardrail/errors'
import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { ChunkGuardrailResult, Guardrail, GuardrailAudit, GuardrailContext } from '../guardrail/types'
import type { SafetyProtocolEvent, SafetyStream, SafetyStreamDirective, SafetyStreamSeal } from '../session'
import { auditDisabledStreamGuards, recordStreamChunkAction } from './audit'
import { firstBoundaryId, runFinalBoundaryGuard } from './boundary'
import { runFinalStreamConstraints, runStreamChunkConstraints } from './constraints'
import { heldMs, streamGuardDecision } from './decision'
import {
  isLegacyStreamConfig,
  segmenterFor,
  streamMaxHoldChars,
  streamOnHoldLimit,
  type StreamSegment,
} from './segment'

export interface CreateSafetyStreamOptions {
  readonly outputGuards: readonly Guardrail[]
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
  readonly guard: Guardrail
  readonly mode: 'legacy' | 'validate'
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
  const outputGuards = options.outputGuards
  const disabledGuards = outputGuards.filter((guard) => guard.stream === false)
  const legacyFullGuards = outputGuards.filter(
    (guard) => isLegacyStreamConfig(guard.stream) && guard.stream.buffer === 'full',
  )
  const finalTextGuards = outputGuards.filter((guard) => guard.stream === 'final')
  const finalBoundaryGuards = outputGuards.filter((guard) => firstBoundaryId(guard) === 'model.output.object')
  const stagedGuards = outputGuards.filter(
    (guard) =>
      !disabledGuards.includes(guard) &&
      !legacyFullGuards.includes(guard) &&
      !finalTextGuards.includes(guard) &&
      !finalBoundaryGuards.includes(guard) &&
      (firstBoundaryId(guard) === 'model.output.text' || firstBoundaryId(guard) === 'model.output'),
  )
  const chunkConstraints = options.constraints.filter((constraint) => constraint.onChunk)

  const stages: StreamStage[] = stagedGuards.map((guard) => ({
    guard,
    mode: guard.onChunk && isLegacyStreamConfig(guard.stream) && guard.stream.buffer === 'none' ? 'legacy' : 'validate',
    segment: segmenterFor(guard.stream),
    maxHoldChars: streamMaxHoldChars(guard.stream),
    onHoldLimit: streamOnHoldLimit(guard.stream),
    buffer: '',
    heldStartedAt: undefined,
  }))

  let sourceText = ''
  let releasedText = ''
  let disabledAudited = false

  async function feed(chunk: string): Promise<SafetyStreamDirective> {
    auditDisabled()
    sourceText += chunk

    if (legacyFullGuards.length > 0) {
      options.transcript.push({ t: 'stream.chunk', directive: 'hold' })
      return { kind: 'hold' }
    }

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

    if (legacyFullGuards.length > 0) {
      const pipeline = createGuardrailPipeline(legacyFullGuards)
      const result = await pipeline.runOutput(sourceText, streamContext(true, sourceText.length, 0))
      options.appendGuardrailAudit(result.audit)
      text = result.content
      pending = text
    } else {
      pending = await runStages('', true)
      text += pending
    }

    if (finalTextGuards.length > 0) {
      const pipeline = createGuardrailPipeline(finalTextGuards)
      const result = await pipeline.runOutput(text, streamContext(true, 0, 0))
      options.appendGuardrailAudit(result.audit)
      text = result.content
      pending = text.slice(releasedText.length)
    }

    for (const guard of finalBoundaryGuards) {
      await runFinalBoundaryGuard(guard, text, streamContext(true, 0, 0))
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
          message: `Stream segmenter for "${stage.guard.name}" returned non-prefix content.`,
          policyId: stage.guard.id,
          heldChars: stage.buffer.length,
          heldMs: heldMs(stage),
        })
      }

      stage.buffer = stage.buffer.slice(segment.length)
      const result = await runStageGuard(stage, segment, last)
      const reportOnly = stage.guard.mode === 'report'

      switch (result.action) {
        case 'pass':
          stage.heldStartedAt = undefined
          output += segment
          break
        case 'warn':
          stage.heldStartedAt = undefined
          recordStreamChunkAction(options.appendGuardrailAudit, stage.guard, result, result.reason)
          output += segment
          break
        case 'redact':
        case 'transform':
          stage.heldStartedAt = undefined
          recordStreamChunkAction(options.appendGuardrailAudit, stage.guard, result)
          output += reportOnly ? segment : result.content
          break
        case 'block':
          recordStreamChunkAction(options.appendGuardrailAudit, stage.guard, result, result.reason, {
            blocked: !reportOnly,
          })
          if (reportOnly) {
            stage.heldStartedAt = undefined
            output += segment
            break
          }
          throw new GuardrailBlockedError({
            guardrailId: stage.guard.name,
            phase: 'output',
            reason: result.reason,
            decisions: [streamGuardDecision(stage.guard, result, segment)],
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
              message: `Stream guardrail "${stage.guard.name}" held content at end of stream.`,
              policyId: stage.guard.id,
              heldChars: stage.buffer.length,
              heldMs: heldMs(stage),
            })
          }
          enforceStageHoldLimit(stage)
          return output
      }
    }
  }

  async function runStageGuard(stage: StreamStage, segment: string, last: boolean): Promise<ChunkGuardrailResult> {
    const context = streamContext(last, stage.buffer.length + segment.length, heldMs(stage))
    if (stage.mode === 'legacy' && stage.guard.onChunk) {
      return stage.guard.onChunk(segment, sourceText, { ...context, mode: stage.guard.mode })
    }
    return stage.guard.validate(segment, { ...context, mode: stage.guard.mode })
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
    auditDisabledStreamGuards(disabledGuards, options.appendGuardrailAudit)
  }

  function enforceStageHoldLimit(stage: StreamStage): void {
    if (stage.buffer.length <= stage.maxHoldChars) return
    if (stage.onHoldLimit === 'release') return
    throw new StreamHoldLimitError({
      message: `Stream guardrail "${stage.guard.name}" exceeded maxHold.`,
      policyId: stage.guard.id,
      heldChars: stage.buffer.length,
      heldMs: heldMs(stage),
    })
  }

  return { feed, finish, transform }
}
