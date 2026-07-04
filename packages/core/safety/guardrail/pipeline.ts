import type {
  Guardrail,
  GuardrailContext,
  GuardrailPhase,
  GuardrailResult,
  GuardrailAudit,
  GuardrailAuditEntry,
} from './types'
import { GuardrailBlockedError } from './errors'
import { observe } from '../../observability'

// ── Pipeline Config ────────────────────────────────────────────────

export interface GuardrailPipelineConfig {
  readonly onBlock?: (guard: Guardrail, detail: { reason: string }) => void
  readonly onRedact?: (guard: Guardrail, detail: { original: string; content: string }) => void
  readonly onTransform?: (guard: Guardrail, detail: { original: string; content: string }) => void
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
  readonly runOutput: (content: string, ctx: GuardrailContext) => Promise<GuardrailPipelineResult>

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
  const inputGuards = guards.filter((g): g is Guardrail<'input'> => g.phase === 'input')
  const outputGuards = guards.filter((g): g is Guardrail<'output'> => g.phase === 'output')

  return {
    guards,

    async runInput(content: string, ctx: GuardrailContext): Promise<GuardrailPipelineResult> {
      return runGuards(inputGuards, content, { ...ctx, phase: 'input' }, config)
    },

    async runOutput(content: string, ctx: GuardrailContext): Promise<GuardrailPipelineResult> {
      return runGuards(outputGuards, content, { ...ctx, phase: 'output' }, config)
    },
  }
}

// ── Internal: Run a list of guards sequentially ────────────────────

async function runGuards<TPhase extends GuardrailPhase>(
  guards: readonly Guardrail<TPhase>[],
  content: string,
  ctx: GuardrailContext,
  config?: GuardrailPipelineConfig,
): Promise<GuardrailPipelineResult> {
  return observe.span(
    {
      name: `${ctx.phase ?? 'unknown'} guardrails`,
      primitive: 'guardrail.run',
      attributes: {
        phase: ctx.phase,
        promptId: ctx.promptId,
        model: ctx.model,
        guardrailCount: guards.length,
      },
    },
    async () => runGuardsInternal(guards, content, ctx, config),
  )
}

async function runGuardsInternal<TPhase extends GuardrailPhase>(
  guards: readonly Guardrail<TPhase>[],
  content: string,
  ctx: GuardrailContext,
  config?: GuardrailPipelineConfig,
): Promise<GuardrailPipelineResult> {
  let currentContent = content
  const entries: GuardrailAuditEntry[] = []

  for (const guard of guards) {
    const start = performance.now()
    const span = observe.openSpan(
      {
        name: guard.name,
        primitive: 'guardrail.run',
        attributes: {
          guardrailName: guard.name,
          category: guard.category,
          phase: guard.phase,
          promptId: ctx.promptId,
          model: ctx.model,
        },
      },
    )
    let result: GuardrailResult<TPhase>
    let durationMs = 0
    try {
      result = await span.withContext(async () => guard.validate(currentContent, ctx))
      durationMs = performance.now() - start
      span.withContext(() =>
        recordGuardrailReport(guard, result.action, durationMs, result, currentContent),
      )
      span.end({ attributes: { action: result.action, durationMs } })
    } catch (error) {
      span.error(error)
      throw error
    }

    const entry: GuardrailAuditEntry = {
      guard: guard.name,
      ...(guard.category !== undefined ? { category: guard.category } : {}),
      phase: guard.phase,
      action: result.action,
      durationMs,
    }

    switch (result.action) {
      case 'pass':
        entries.push(entry)
        break

      case 'block':
        entries.push(entry)
        config?.onBlock?.(guard, { reason: result.reason })
        span.withContext(() => recordGuardrailBlockedEdge(guard.name, result.reason))
        throw new GuardrailBlockedError({
          guardrailId: guard.name,
          phase: guard.phase,
          reason: result.reason,
        })

      case 'redact':
        entries.push({ ...entry, original: currentContent })
        config?.onRedact?.(guard, { original: currentContent, content: result.content })
        currentContent = result.content
        break

      case 'transform':
        entries.push({ ...entry, original: currentContent })
        config?.onTransform?.(guard, { original: currentContent, content: result.content })
        currentContent = result.content
        break

      case 'warn':
        entries.push(entry)
        config?.onWarn?.(guard, { reason: result.reason })
        break

      default:
        // Exhaustiveness check for future actions
        entries.push(entry)
    }
  }

  return {
    content: currentContent,
    audit: { applied: entries, blocked: false },
  }
}

function recordGuardrailReport(
  guard: Guardrail<GuardrailPhase>,
  action: string,
  durationMs: number,
  result: unknown,
  beforeContent: string,
): void {
  const guardrailName = guard.name
  const phase = guard.phase
  const activeSpanId = observe.captureContext()?.currentSpanId
  const artifactId = observe.artifact({
    kind: 'guardrail.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: guardrailReportPreview(phase, action, result, beforeContent),
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
  phase: GuardrailPhase,
  action: string,
  result: unknown,
  beforeContent: string,
): Record<string, unknown> {
  const base = {
    kind: 'guardrail.report',
    phase,
    action,
    beforePreview: beforeContent.slice(0, 500),
  }
  if (!result || typeof result !== 'object') {
    return base
  }
  const record = result as Record<string, unknown>
  return {
    ...base,
    ...record,
    ...(typeof record.content === 'string' ? { afterPreview: record.content.slice(0, 500) } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}
