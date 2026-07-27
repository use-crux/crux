import type {
  Guardrail,
  GuardrailContext,
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailRunResult,
} from './types'
import { GuardrailBlockedError } from './errors'
import type { SafetyDecision } from '../decision'
import type { BoundaryDef } from '../boundary'
import type { GuardrailBinding } from '../registry'
import { safeCaptureSummary } from '../errors'
import { observe } from '../../observability'
import type { z } from 'zod'
import {
  applyTerminalRewrite,
  terminalSubject,
} from '../output/guardrail-state'
import { auditAction, runGuardWithObservability } from './run-guard'

// ── Pipeline Config ────────────────────────────────────────────────

export interface GuardrailPipelineConfig {
  readonly onBlock?: (guard: Guardrail, detail: { reason: string }) => void
  readonly onRedact?: (guard: Guardrail, detail: { content: string }) => void
  readonly onTransform?: (guard: Guardrail, detail: { content: string }) => void
  readonly onWarn?: (guard: Guardrail, detail: { reason: string }) => void
}

// ── Pipeline Result ────────────────────────────────────────────────

export interface GuardrailPipelineResult {
  readonly content: string
  readonly parsed?: unknown
  readonly audit: GuardrailAudit
}

// ── Pipeline ───────────────────────────────────────────────────────

export interface GuardrailPipeline {
  /** Run input-phase guards on content. Throws GuardrailBlockedError on block. */
  readonly runInput: (
    content: string,
    ctx: GuardrailContext,
  ) => Promise<GuardrailPipelineResult>

  /** Run output-phase guards on content. Throws GuardrailBlockedError on block. */
  readonly runOutput: (
    content: string,
    ctx: GuardrailContext,
    opts?: { readonly parsed?: unknown; readonly schema?: z.ZodType },
  ) => Promise<GuardrailPipelineResult>

  /** All exact guardrail bindings in the pipeline. */
  readonly bindings: readonly GuardrailBinding[]
}

/**
 * Create a guardrail pipeline that auto-splits guards by phase.
 *
 * - Input guards run via `runInput()` before `generate()`.
 * - Output guards run via `runOutput()` after `generate()`.
 * - Guards execute in declaration order within their phase.
 * - Redacted/transformed content flows forward to subsequent guards.
 * - First `block` short-circuits — remaining guards do not run.
 *
 * Guardrails filter content but never re-call the model.
 * For retry-with-feedback on output quality, use `constraint()`.
 */
export function createGuardrailPipeline(
  bindings: readonly GuardrailBinding[],
  config?: GuardrailPipelineConfig,
): GuardrailPipeline {
  const inputBindings = bindings.filter(
    (binding) => boundaryPhase(binding.boundary) === 'input',
  )
  const outputBindings = bindings.filter(
    (binding) => boundaryPhase(binding.boundary) === 'output',
  )

  return {
    bindings,

    async runInput(
      content: string,
      ctx: GuardrailContext,
    ): Promise<GuardrailPipelineResult> {
      return runGuards(inputBindings, content, ctx, 'input', config)
    },

    async runOutput(
      content: string,
      ctx: GuardrailContext,
      opts?: { readonly parsed?: unknown; readonly schema?: z.ZodType },
    ): Promise<GuardrailPipelineResult> {
      return runGuards(
        outputBindings,
        content,
        ctx,
        'output',
        config,
        opts?.parsed,
        opts?.schema,
      )
    },
  }
}

// ── Internal: Run a list of guards sequentially ────────────────────

async function runGuards(
  bindings: readonly GuardrailBinding[],
  content: string,
  ctx: GuardrailContext,
  phase: 'input' | 'output',
  config?: GuardrailPipelineConfig,
  parsed?: unknown,
  schema?: z.ZodType,
): Promise<GuardrailPipelineResult> {
  return observe.span(
    {
      name: `${phase} guardrails`,
      primitive: 'guardrail.run',
      attributes: {
        phase,
        promptId: ctx.promptId,
        model: ctx.model,
        guardrailCount: bindings.length,
      },
    },
    async () =>
      runGuardsInternal(bindings, content, ctx, phase, config, parsed, schema),
  )
}

async function runGuardsInternal(
  bindings: readonly GuardrailBinding[],
  content: string,
  ctx: GuardrailContext,
  phase: 'input' | 'output',
  config?: GuardrailPipelineConfig,
  parsed?: unknown,
  schema?: z.ZodType,
): Promise<GuardrailPipelineResult> {
  let current: import('../structured').StructuredSafetyOutput = {
    text: content,
    parsed,
  }
  const entries: GuardrailAuditEntry[] = []

  for (const binding of bindings) {
    const guard = binding.policy
    const boundary = binding.boundary
    const { result, entry, durationMs } = await runGuardWithObservability({
      binding,
      subject: terminalSubject(boundary, current),
      ctx,
      phase,
      streaming: false,
      last: true,
    })

    switch (result.action) {
      case 'allow':
        entries.push(entry)
        break

      case 'block':
        entries.push(entry)
        if (binding.mode === 'report') break
        config?.onBlock?.(guard, { reason: result.reason })
        throw new GuardrailBlockedError({
          guardrailId: guard.id,
          phase,
          reason: result.reason,
          decisions: [
            guardDecision(
              binding,
              result,
              current.text,
              durationMs,
              ctx,
              entry.findings,
            ),
          ],
        })

      case 'rewrite': {
        entries.push(entry)
        if (binding.mode !== 'report') {
          const rewritten = applyTerminalRewrite(
            boundary,
            current,
            result.value,
            {
              schema,
              policyId: guard.id,
            },
          )
          const content = rewritten.text
          if (result.rewrite.kind === 'normalize') {
            config?.onTransform?.(guard, { content })
          } else {
            config?.onRedact?.(guard, { content })
          }
          current = rewritten
        }
        break
      }

      case 'warn':
        entries.push(entry)
        config?.onWarn?.(guard, { reason: result.reason })
        break

      default:
        entries.push(entry)
    }
  }

  return {
    content: current.text,
    ...(current.parsed !== undefined ? { parsed: current.parsed } : {}),
    audit: { applied: entries, blocked: false },
  }
}

function guardDecision(
  binding: GuardrailBinding,
  result: GuardrailRunResult<unknown>,
  content: string,
  durationMs: number,
  context: GuardrailContext,
  findings: GuardrailAuditEntry['findings'],
): SafetyDecision {
  const guard = binding.policy
  return {
    policyId: guard.id,
    kind: 'guardrail',
    boundary: binding.boundary.id,
    ...(context.origin ? { origin: context.origin } : {}),
    mode: binding.mode,
    action: safetyAction(result),
    ...(result.action === 'block' || result.action === 'warn'
      ? { reason: result.reason }
      : {}),
    ...(findings ? { findings } : {}),
    ...(binding.tuned ? { tuned: binding.tuned } : {}),
    durationMs,
    captured: safeCaptureSummary(result.action === 'block' ? '' : content),
  }
}

function safetyAction(
  result: GuardrailRunResult<unknown>,
): SafetyDecision['action'] {
  if (result.action === 'allow' || result.action === 'hold') return 'allow'
  if (result.action === 'rewrite') return 'rewrite'
  return result.action
}

function boundaryPhase(boundary: BoundaryDef): 'input' | 'output' {
  return boundary.id === 'model.input.text' ||
    boundary.id === 'model.input.media' ||
    boundary.id === 'model.instructions' ||
    boundary.id === 'model.input.tools' ||
    boundary.id === 'validation.feedback'
    ? 'input'
    : 'output'
}
