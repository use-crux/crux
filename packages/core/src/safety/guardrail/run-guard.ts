/**
 * Shared per-guard evaluation and observability (RFC #173).
 *
 * One helper owns running a single guardrail over a subject: it opens the guard
 * span, runs the policy within that span's context, validates the run result,
 * records the report edge (and the blocked edge on an enforced block), ends the
 * span, and returns the canonical audit entry. The terminal pipeline and the
 * structured occurrence engine both drive their guards through it so their spans,
 * reports, and audit entries are identical — callers keep only their own content
 * mutation, block-decision construction, and config callbacks.
 *
 * @module
 */

import { selectedPath } from '../boundary'
import type { BoundaryDef } from '../boundary'
import type { SafetyFinding, SafetyRunContext } from '../decision'
import { inputOriginAttributes } from '../input-origin-observability'
import type { GuardrailBinding } from '../registry'
import { observe } from '../../observability'
import { guardrailDefinitionRef } from '../../observability/definition-ref'
import { recordGuardrailBlockedEdge, recordGuardrailReport } from './observability'
import {
  createGuardrailFindingCollection,
  mergeSafetyFindings,
} from './findings'
import { findingCountAttributes } from './finding-observability'
import { validateGuardrailRunResult } from './result-validation'
import type {
  MemoryWriteGuardrailResult,
  ToolDefinitionGuardrailResult,
} from './specialized-results'
import type {
  GuardrailAuditEntry,
  GuardrailContext,
  GuardrailOrigin,
  GuardrailRunResult,
} from './types'
import type { ModelInputOrigin } from '../input-origin'

type ObservableGuardrailResult =
  | GuardrailRunResult<unknown>
  | ToolDefinitionGuardrailResult
  | MemoryWriteGuardrailResult

interface GuardrailResultValidationOptions {
  readonly streaming: boolean
  readonly last: boolean
  readonly policyId: string
  readonly boundary: string
}

type GuardrailResultValidator<TResult extends ObservableGuardrailResult> = (
  value: unknown,
  options: GuardrailResultValidationOptions,
) => TResult

export interface RunGuardInput<
  TResult extends ObservableGuardrailResult = GuardrailRunResult<unknown>,
  TOrigin extends GuardrailOrigin = ModelInputOrigin,
> {
  readonly binding: GuardrailBinding
  /** The already-resolved subject for this guard (terminal content or occurrence value). */
  readonly subject: unknown
  readonly ctx: GuardrailContext<TOrigin>
  readonly phase: 'input' | 'output'
  readonly streaming: boolean
  readonly last: boolean
  /** Specialized validator for closed non-standard result families. */
  readonly validateResult?: GuardrailResultValidator<TResult>
}

export interface RunGuardOutcome<
  TResult extends ObservableGuardrailResult = GuardrailRunResult<unknown>,
> {
  readonly result: TResult
  readonly entry: GuardrailAuditEntry
  readonly durationMs: number
}

/**
 * Run one guard with full observability and return its validated result and
 * canonical audit entry. Rethrows a thrown policy after recording `span.error`.
 * The span, report edge, and (for an enforced block) blocked edge are recorded
 * here; the caller decides what to do with the result.
 */
export async function runGuardWithObservability<
  TResult extends ObservableGuardrailResult = GuardrailRunResult<unknown>,
  TOrigin extends GuardrailOrigin = ModelInputOrigin,
>(
  input: RunGuardInput<TResult, TOrigin>,
): Promise<RunGuardOutcome<TResult>> {
  const { binding, subject, ctx, phase, streaming, last } = input
  const guard = binding.policy
  const boundary = binding.boundary
  const findingCollection = createGuardrailFindingCollection({
    policyId: guard.id,
    boundary: boundary.id,
  })
  const start = performance.now()
  // `guardrail()` requires `id`, so this ref is always canonical.
  const span = observe.openSpan({
    name: guard.id,
    primitive: 'guardrail.run',
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
  })

  let result: TResult
  let findings: readonly SafetyFinding[] | undefined
  let durationMs = 0
  try {
    const raw = await span.withContext(async () =>
      guard.run(
        subject as never,
        runContext(binding, ctx, findingCollection.collector) as never,
      ),
    )
    const validationOptions = {
      streaming,
      last,
      policyId: guard.id,
      boundary: boundary.id,
    }
    result = input.validateResult
      ? input.validateResult(raw, validationOptions)
      : (validateGuardrailRunResult(
          raw,
          validationOptions,
        ) as TResult)
    findings = mergeSafetyFindings(
      findingCollection.snapshot(),
      result.action === 'rewrite' && 'findings' in result
        ? result.findings
        : undefined,
    )
    durationMs = performance.now() - start
    const report = result
    span.withContext(() =>
      recordGuardrailReport(
        binding,
        auditAction(report),
        phase,
        durationMs,
        report,
        ctx.origin,
        findings,
      ),
    )
    if (report.action === 'block' && binding.mode !== 'report') {
      const { reason } = report
      span.withContext(() =>
        recordGuardrailBlockedEdge(binding, reason, ctx.origin, findings),
      )
    }
    span.end({
      attributes: {
        action: auditAction(result),
        ...findingCountAttributes(findings),
        durationMs,
      },
    })
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
    ...('reason' in result ? { reason: result.reason } : {}),
    ...(findings ? { findings } : {}),
    durationMs,
  }

  return { result, entry, durationMs }
}

/** The audit/observability action name for a run result (rewrite → its rewrite kind). */
export function auditAction(result: ObservableGuardrailResult): string {
  if (result.action === 'rewrite') return result.rewrite.kind === 'normalize' ? 'transform' : result.rewrite.kind
  return result.action
}

/** Build the `SafetyRunContext` handed to a guard policy for one execution. */
export function runContext<
  B extends BoundaryDef,
  TOrigin extends GuardrailOrigin,
>(
  binding: GuardrailBinding & { readonly boundary: B },
  ctx: GuardrailContext<TOrigin>,
  findings: SafetyRunContext<B>['findings'],
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
    findings,
    ...(ctx.stream ? { stream: ctx.stream } : {}),
    ...(selectedPath(boundary) ? { path: selectedPath(boundary) } : {}),
    ...(ctx.origin ? { origin: ctx.origin } : {}),
  } as SafetyRunContext<B>
}
