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
import { safeCaptureSummary } from '../errors'
import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'

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
    opts?: { readonly parsed?: unknown },
  ) => Promise<GuardrailPipelineResult>

  /** All guards in the pipeline. */
  readonly guards: readonly Guardrail[]
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
  guards: readonly Guardrail[],
  config?: GuardrailPipelineConfig,
): GuardrailPipeline {
  const inputGuards = guards.filter((g) => guardPhase(g) === 'input')
  const outputGuards = guards.filter((g) => guardPhase(g) === 'output')

  return {
    guards,

    async runInput(content: string, ctx: GuardrailContext): Promise<GuardrailPipelineResult> {
      return runGuards(inputGuards, content, ctx, 'input', config)
    },

    async runOutput(
      content: string,
      ctx: GuardrailContext,
      opts?: { readonly parsed?: unknown },
    ): Promise<GuardrailPipelineResult> {
      return runGuards(outputGuards, content, ctx, 'output', config, opts?.parsed)
    },
  }
}

// ── Internal: Run a list of guards sequentially ────────────────────

async function runGuards(
  guards: readonly Guardrail[],
  content: string,
  ctx: GuardrailContext,
  phase: 'input' | 'output',
  config?: GuardrailPipelineConfig,
  parsed?: unknown,
): Promise<GuardrailPipelineResult> {
  return observe.span(
    {
      name: `${phase} guardrails`,
      primitive: 'guardrail.run',
      attributes: {
        phase,
        promptId: ctx.promptId,
        model: ctx.model,
        guardrailCount: guards.length,
      },
    },
    async () => runGuardsInternal(guards, content, ctx, phase, config, parsed),
  )
}

async function runGuardsInternal(
  guards: readonly Guardrail[],
  content: string,
  ctx: GuardrailContext,
  phase: 'input' | 'output',
  config?: GuardrailPipelineConfig,
  parsed?: unknown,
): Promise<GuardrailPipelineResult> {
  let currentContent = content
  const entries: GuardrailAuditEntry[] = []

  for (const guard of guards) {
    const start = performance.now()
    const boundary = firstBoundary(guard)
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
          phase,
          promptId: ctx.promptId,
          model: ctx.model,
        },
      },
    )
    let result: GuardrailRunResult<unknown>
    let durationMs = 0
    try {
      result = validateGuardrailRunResult(
        await span.withContext(async () =>
          guard.run(
            subjectForBoundary(boundary, currentContent, parsed) as never,
            runContext(guard, boundary, ctx) as never,
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
        recordGuardrailReport(guard, auditAction(result), phase, durationMs, result),
      )
      span.end({ attributes: { action: auditAction(result), durationMs } })
    } catch (error) {
      span.error(error)
      throw error
    }

    const entry: GuardrailAuditEntry = {
      guard: guard.id,
      ...(guard.category !== undefined ? { category: guard.category } : {}),
      phase,
      action: auditAction(result),
      durationMs,
    }

    switch (result.action) {
      case 'allow':
        entries.push(entry)
        break

      case 'block':
        entries.push(entry)
        if (guard.mode === 'report') break
        config?.onBlock?.(guard, { reason: result.reason })
        span.withContext(() => recordGuardrailBlockedEdge(guard.id, result.reason))
        throw new GuardrailBlockedError({
          guardrailId: guard.id,
          phase,
          reason: result.reason,
          decisions: [guardDecision(guard, result, currentContent, durationMs, phase)],
        })

      case 'rewrite': {
        entries.push(entry)
        if (guard.mode !== 'report') {
          const content = stringifyGuardrailValue(result.value)
          if (result.rewrite.kind === 'normalize') {
            config?.onTransform?.(guard, { content })
          } else {
            config?.onRedact?.(guard, { content })
          }
          currentContent = content
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
    content: currentContent,
    audit: { applied: entries, blocked: false },
  }
}

function guardDecision(
  guard: Guardrail,
  result: GuardrailRunResult<unknown>,
  content: string,
  durationMs: number,
  phase: 'input' | 'output',
): SafetyDecision {
  return {
    policyId: guard.id,
    kind: 'guardrail',
    boundary: phase === 'input' ? 'user.input' : 'model.output.text',
    mode: guard.mode,
    action: safetyAction(result),
    ...(result.action === 'block' || result.action === 'warn' ? { reason: result.reason } : {}),
    durationMs,
    captured: safeCaptureSummary(result.action === 'block' ? '' : content),
  }
}

function safetyAction(result: GuardrailRunResult<unknown>): SafetyDecision['action'] {
  if (result.action === 'allow' || result.action === 'hold') return 'allow'
  if (result.action === 'rewrite') return 'rewrite'
  return result.action
}

function recordGuardrailReport(
  guard: Guardrail,
  action: string,
  phase: 'input' | 'output',
  durationMs: number,
  result: unknown,
): void {
  const guardrailName = guard.id
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: guardrailReportPreview(phase, action, result),
    attributes: {
      guardrailName,
      category: guard.category,
      phase,
      action,
      durationMs,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'produced',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { guardrailName, action },
    })
  }
  observe.event({
    name: 'guardrail.action',
    attributes: { guardrailName, phase, action, durationMs },
  })
}

function recordGuardrailBlockedEdge(guardrailName: string, reason: string): void {
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: { kind: 'guardrail.report', action: 'block', reason },
    attributes: {
      guardrailName,
      action: 'block',
      reason,
    },
  })
  if (activeSpanId && artifactId) {
    observe.edge({
      edgeType: 'guardrail.blocked',
      from: { kind: 'span', id: activeSpanId },
      to: { kind: 'artifact', id: artifactId },
      attributes: { guardrailName, reason },
    })
  }
}

function guardrailReportPreview(
  phase: 'input' | 'output',
  action: string,
  result: unknown,
): Record<string, unknown> {
  const base = {
    kind: 'guardrail.report',
    phase,
    action,
  }
  if (!result || typeof result !== 'object') {
    return base
  }
  const record = result as Record<string, unknown>
  return {
    ...base,
    ...record,
    ...(typeof record.value === 'string' ? { afterPreview: record.value.slice(0, 500) } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}

function guardPhase(guard: Guardrail): 'input' | 'output' {
  const boundaries = Array.isArray(guard.on) ? guard.on : [guard.on]
  return boundaries.some((boundary) => boundary.id === 'user.input' || boundary.id === 'model.input') ? 'input' : 'output'
}

function firstBoundary(guard: Guardrail): BoundaryDef {
  return Array.isArray(guard.on) ? (guard.on[0] ?? { _tag: 'Boundary', id: 'model.output.text' }) : guard.on
}

function runContext<B extends BoundaryDef>(
  guard: Guardrail,
  boundary: B,
  ctx: GuardrailContext,
): SafetyRunContext<B> {
  return {
    policy: { id: guard.id, mode: ctx.mode ?? guard.mode },
    boundary: { id: boundary.id as never, kind: boundary.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(ctx.stream ? { stream: ctx.stream } : {}),
    ...(boundary.path ? { path: boundary.path } : {}),
  }
}

function subjectForBoundary(boundary: BoundaryDef, content: string, parsed: unknown): unknown {
  if (boundary.id === 'model.output') return { text: content, object: parsed }
  return content
}

function stringifyGuardrailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function auditAction(result: GuardrailRunResult<unknown>): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}
