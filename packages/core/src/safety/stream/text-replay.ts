/**
 * Shared text-occurrence replay engine (RFC #173).
 *
 * One engine owns text-unit segmentation, ordered guard execution, report mode,
 * rewrite, hold/replay, char/ms limits, audit, and EOF behavior — driven by a
 * source adapter that feeds fragments then finishes. Generate feeds the complete
 * text once (adaptive → one complete occurrence); stream feeds canonical deltas
 * (adaptive → per delta). Every explicit refinement (`.sentences()`/`.lines()`/
 * `.segments()`) and bundled semantic default segments identically on both.
 *
 * Non-text terminal boundaries (object/media) keep their own orchestration.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import { StreamHoldLimitError } from '../errors'
import { emitAdaptiveDeltaNotice } from '../guardrail/adaptive-notice'
import { GuardrailBlockedError } from '../guardrail/errors'
import { createGuardrailPipeline } from '../guardrail/pipeline'
import type { GuardrailAudit, GuardrailContext, GuardrailRunResult } from '../guardrail/types'
import { validateGuardrailRunResult } from '../guardrail/types'
import type { GuardrailBinding } from '../registry'
import { recordStreamChunkAction } from './audit'
import { heldMs, streamGuardDecision } from './decision'
import {
  maxHoldCharsForUnit,
  maxHoldMsForUnit,
  resolveTextUnit,
  segmenterForUnit,
  type ResolvedTextUnit,
  type StreamSegment,
  type TextReplayMode,
} from './segment'

export type { TextReplayMode } from './segment'

interface Stage {
  readonly binding: GuardrailBinding
  readonly segment: StreamSegment
  readonly maxHoldChars: number
  readonly maxHoldMs: number | undefined
  buffer: string
  heldStartedAt: number | undefined
}

export interface TextReplayEngine {
  /** Feed one canonical source fragment; returns the content released by it. */
  readonly feed: (fragment: string) => Promise<string>
  /** Flush at EOF: drain held units + run complete-unit guards over the full text. */
  readonly finish: () => Promise<{ readonly text: string; readonly pending: string }>
}

export interface TextReplayOptions {
  readonly textBindings: readonly GuardrailBinding[]
  readonly mode: TextReplayMode
  /** Full guard context (including canonical messages) for this call. */
  readonly guardContext: () => GuardrailContext
  readonly appendGuardrailAudit: (audit: GuardrailAudit) => void
}

/** Create the shared text-occurrence replay engine for one execution. */
export function createTextReplayEngine(options: TextReplayOptions): TextReplayEngine {
  const streaming = options.mode === 'stream'
  const resolved = new Map<GuardrailBinding, ResolvedTextUnit>()
  const unitFor = (binding: GuardrailBinding): ResolvedTextUnit => {
    const cached = resolved.get(binding)
    if (cached) return cached
    const next = resolveTextUnit(binding.boundary, binding.policy.strategy?.defaultUnit, options.mode)
    resolved.set(binding, next)
    return next
  }

  // A `complete` unit is evaluated once over the full text at finish; growing
  // units (delta/sentence/line/segment) are staged and gate each unit in order.
  // Only a real stream execution warns: a custom output-text guardrail (no bundled
  // strategy) resolved to the adaptive per-delta default may miss cross-delta
  // matches. Any explicit refinement or bundled default changes the resolution and
  // suppresses this; the notice is deduped once per guardrail definition.
  if (streaming) {
    for (const binding of options.textBindings) {
      const unit = unitFor(binding)
      if (unit.source === 'adaptive' && unit.unit === 'delta' && binding.policy.strategy === undefined) {
        emitAdaptiveDeltaNotice(binding.policy.id)
      }
    }
  }

  const finalTextBindings = options.textBindings.filter((binding) => unitFor(binding).unit === 'complete')
  const stages: Stage[] = options.textBindings
    .filter((binding) => unitFor(binding).unit !== 'complete')
    .map((binding) => {
      const unit = unitFor(binding)
      return {
        binding,
        segment: segmenterForUnit(unit),
        maxHoldChars: maxHoldCharsForUnit(unit),
        maxHoldMs: maxHoldMsForUnit(unit),
        buffer: '',
        heldStartedAt: undefined,
      }
    })

  let releasedText = ''

  async function feed(fragment: string): Promise<string> {
    const content = await runStages(fragment, false)
    releasedText += content
    return content
  }

  async function finish(): Promise<{ text: string; pending: string }> {
    let pending = await runStages('', true)
    const releasedBeforeFinal = releasedText
    releasedText += pending
    let text = releasedText

    if (finalTextBindings.length > 0) {
      const pipeline = createGuardrailPipeline(finalTextBindings)
      const result = await pipeline.runOutput(text, guardContext(true, 0, 0))
      options.appendGuardrailAudit(result.audit)
      text = result.content
      // Everything not already released during `feed` is pending at EOF.
      pending = text.slice(releasedBeforeFinal.length)
      releasedText = text
    }

    return { text, pending }
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

  async function drainStage(stage: Stage, last: boolean): Promise<string> {
    let output = ''
    for (;;) {
      if (stage.buffer.length === 0) {
        stage.heldStartedAt = undefined
        return output
      }

      const segment = stage.segment(stage.buffer, last)
      if (segment === null || segment.length === 0) {
        if (last) {
          throw new StreamHoldLimitError({
            message: `Stream guardrail "${stage.binding.policy.id}" held content at end of stream.`,
            policyId: stage.binding.policy.id,
            heldChars: stage.buffer.length,
            heldMs: heldMs(stage),
          })
        }
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

  async function runStageGuard(stage: Stage, segment: string, last: boolean): Promise<GuardrailRunResult<unknown>> {
    const context = guardContext(last, stage.buffer.length + segment.length, heldMs(stage))
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
        ...(context.stream ? { stream: context.stream } : {}),
        ...(selectedPath(boundary) ? { path: selectedPath(boundary) } : {}),
      } as never),
      { streaming, last, policyId: guard.id, boundary: boundary.id },
    )
  }

  function guardContext(last: boolean, heldChars: number, heldMsValue: number): GuardrailContext {
    const base = options.guardContext()
    if (!streaming) return base
    return { ...base, stream: { segment: true, last, heldChars, heldMs: heldMsValue } }
  }

  function enforceStageHoldLimit(stage: Stage): void {
    const elapsedMs = heldMs(stage)
    const overChars = stage.buffer.length > stage.maxHoldChars
    const overMs = stage.maxHoldMs !== undefined && elapsedMs > stage.maxHoldMs
    if (!overChars && !overMs) return
    throw new StreamHoldLimitError({
      // Limit diagnostics carry only sizes/durations/identity — never held content.
      message: `Stream guardrail "${stage.binding.policy.id}" exceeded ${overChars ? 'maxHold chars' : 'maxHold ms'}.`,
      policyId: stage.binding.policy.id,
      heldChars: stage.buffer.length,
      heldMs: elapsedMs,
    })
  }

  return { feed, finish }
}

function stringifyGuardrailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
