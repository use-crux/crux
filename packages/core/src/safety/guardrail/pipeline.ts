import type {
  Guardrail,
  GuardrailContext,
  GuardrailAudit,
  GuardrailAuditEntry,
  GuardrailRunResult,
} from './types'
import { validateGuardrailRunResult } from './types'
import { GuardrailBlockedError } from './errors'
import type { SafetyDecision, SafetyRunContext } from '../decision'
import type { BoundaryDef } from '../boundary'
import type { GuardrailBinding } from '../registry'
import { safeCaptureSummary } from '../errors'
import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import { recordGuardrailBlockedEdge, recordGuardrailReport } from './observability'
import type { z } from 'zod'
import { applyTerminalRewrite, terminalSubject } from '../output/guardrail-state'
import { inputOriginAttributes } from '../input-origin-observability'

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
  readonly runInput: (content: string, ctx: GuardrailContext) => Promise<GuardrailPipelineResult>

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
  const inputBindings = bindings.filter((binding) => boundaryPhase(binding.boundary) === 'input')
  const outputBindings = bindings.filter((binding) => boundaryPhase(binding.boundary) === 'output')

  return {
    bindings,

    async runInput(content: string, ctx: GuardrailContext): Promise<GuardrailPipelineResult> {
      return runGuards(inputBindings, content, ctx, 'input', config)
    },

    async runOutput(
      content: string,
      ctx: GuardrailContext,
      opts?: { readonly parsed?: unknown; readonly schema?: z.ZodType },
    ): Promise<GuardrailPipelineResult> {
      return runGuards(outputBindings, content, ctx, 'output', config, opts?.parsed, opts?.schema)
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
    async () => runGuardsInternal(bindings, content, ctx, phase, config, parsed, schema),
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
  let current: import('../structured').StructuredSafetyOutput = { text: content, parsed }
  const entries: GuardrailAuditEntry[] = []

  for (const binding of bindings) {
    const guard = binding.policy
    const start = performance.now()
    const boundary = binding.boundary
    const span = observe.openSpan(
      {
        name: guard.id,
        primitive: 'guardrail.run',
        // `guardrail()` requires `id`, so this ref is always canonical. The
        // outer `${phase} guardrails` group span covers many guards and gets none.
        definitionRefs: [guardrailDefinitionRef(guard.id)],
        attributes: {
          guardrailName: guard.id,
          category: guard.category,
          boundary: boundary.id,
          mode: binding.mode,
          phase,
          promptId: ctx.promptId,
          model: ctx.model,
          ...inputOriginAttributes(ctx.origin),
        },
      },
    )
    let result: GuardrailRunResult<unknown>
    let durationMs = 0
    try {
      result = validateGuardrailRunResult(
        await span.withContext(async () =>
          guard.run(
            terminalSubject(boundary, current) as never,
            runContext(binding, ctx) as never,
          ),
        ),
        {
          streaming: false,
          last: true,
          policyId: guard.id,
          boundary: boundary.id,
        },
      )
      durationMs = performance.now() - start
      span.withContext(() =>
        recordGuardrailReport(binding, auditAction(result), phase, durationMs, result, ctx.origin),
      )
      span.end({ attributes: { action: auditAction(result), durationMs } })
    } catch (error) {
      span.error(error)
      throw error
    }

    const entry: GuardrailAuditEntry = {
      guard: guard.id,
      ...(guard.category !== undefined ? { category: guard.category } : {}),
      boundary: boundary.id,
      ...(ctx.origin ? { origin: ctx.origin } : {}),
      mode: binding.mode,
      phase,
      action: auditAction(result),
      ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
      durationMs,
    }

    switch (result.action) {
      case 'allow':
        entries.push(entry)
        break

      case 'block':
        entries.push(entry)
        if (binding.mode === 'report') break
        config?.onBlock?.(guard, { reason: result.reason })
        span.withContext(() => recordGuardrailBlockedEdge(binding, result.reason, ctx.origin))
        throw new GuardrailBlockedError({
          guardrailId: guard.id,
          phase,
          reason: result.reason,
          decisions: [guardDecision(binding, result, current.text, durationMs, ctx)],
        })

      case 'rewrite': {
        entries.push(entry)
        if (binding.mode !== 'report') {
          const rewritten = applyTerminalRewrite(boundary, current, result.value, {
            schema,
            policyId: guard.id,
          })
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
): SafetyDecision {
  const guard = binding.policy
  return {
    policyId: guard.id,
    kind: 'guardrail',
    boundary: binding.boundary.id,
    ...(context.origin ? { origin: context.origin } : {}),
    mode: binding.mode,
    action: safetyAction(result),
    ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
    ...(binding.tuned ? { tuned: binding.tuned } : {}),
    durationMs,
    captured: safeCaptureSummary(result.action === 'block' ? '' : content),
  }
}

function safetyAction(result: GuardrailRunResult<unknown>): SafetyDecision['action'] {
  if (result.action === 'allow' || result.action === 'hold') return 'allow'
  if (result.action === 'rewrite') return 'rewrite'
  return result.action
}

function boundaryPhase(boundary: BoundaryDef): 'input' | 'output' {
  return boundary.id === 'model.input.text' ||
    boundary.id === 'model.input.media' ||
    boundary.id === 'model.instructions'
    ? 'input'
    : 'output'
}

function runContext<B extends BoundaryDef>(
  binding: GuardrailBinding & { readonly boundary: B },
  ctx: GuardrailContext,
): SafetyRunContext<B> {
  const guard = binding.policy
  const boundary = binding.boundary
  return {
    policy: { id: guard.id, mode: binding.mode },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(ctx.stream ? { stream: ctx.stream } : {}),
    ...(boundary.path ? { path: boundary.path } : {}),
    ...(ctx.origin ? { origin: ctx.origin } : {}),
  } as SafetyRunContext<B>
}

function auditAction(result: GuardrailRunResult<unknown>): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}
