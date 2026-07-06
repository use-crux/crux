import type { z } from 'zod'
import type { BoundaryDef } from '../boundary'
import { boundary } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { captureSource } from '../../project-index/source'
import type {
  Constraint,
  ConstraintCheckResult,
  ConstraintConfig,
  ConstraintContext,
  ConstraintOutput,
  LegacyConstraintConfig,
} from './types'
import { validateConstraintRunResult } from './types'
import { citations } from './strategies/citations'
import { judge } from './strategies/judge'

/** Module-scoped map: frozen constraint -> definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a constraint instance. */
export function getConstraintDefinitionSource(
  constraint: object,
): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(constraint)
}

/**
 * Define a retryable semantic assertion for one safety boundary.
 *
 * The `on` boundary drives the subject type passed to `run`; use guardrails
 * for protective rewrites/blocks and constraints for retryable success rules.
 */
interface ConstraintFactory {
  <B extends BoundaryDef>(config: ConstraintConfig<B>): Constraint<B>
  /** @internal Transitional overload for pre-migration source files. */
  <TSchema extends z.ZodType = z.ZodType<unknown>>(
    config: LegacyConstraintConfig<TSchema>,
  ): Constraint<TSchema>
  /** Built-in LLM-as-a-judge constraint strategy. */
  readonly judge: typeof judge
  /** Built-in grounded-citation constraint strategy. */
  readonly citations: typeof citations
}

function defineConstraint<B extends BoundaryDef>(config: ConstraintConfig<B>): Constraint<B>
function defineConstraint<TSchema extends z.ZodType = z.ZodType<unknown>>(
  config: LegacyConstraintConfig<TSchema>,
): Constraint<TSchema>
function defineConstraint<B extends BoundaryDef>(
  config: ConstraintConfig<B> | LegacyConstraintConfig,
): Constraint<B> | Constraint<z.ZodType<unknown>> {
  const defSource = captureSource()
  const c = isLegacyConstraintConfig(config) ? defineLegacyConstraint(config) : defineBoundaryConstraint(config)

  if (defSource) definitionSourceMap.set(c, defSource)
  return c
}

export const constraint: ConstraintFactory = Object.assign(defineConstraint, {
  judge,
  citations,
})

/** Runtime type guard: checks if a value is a Constraint. */
export function isConstraint(value: unknown): value is Constraint {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    '_tag' in value &&
    (value as { readonly _tag?: unknown })._tag === 'Constraint'
  )
}

function defineBoundaryConstraint<B extends BoundaryDef>(config: ConstraintConfig<B>): Constraint<B> {
  const strategy = strategyMetadata(config.run)
  const c = Object.freeze({
    _tag: 'Constraint' as const,
    id: config.id,
    on: config.on,
    category: config.category,
    severity: config.severity ?? 'assert',
    maxRetries: config.maxRetries ?? 2,
    run: config.run,
    ...(strategy ? { strategy } : {}),
    name: config.id,
    check: async (output: ConstraintOutput, ctx: ConstraintContext): Promise<ConstraintCheckResult> => {
      const runCtx = contextForConstraint(config.id, config.on, ctx)
      const subject = subjectForBoundary(config.on, output)
      return validateConstraintRunResult(await config.run(subject as never, runCtx as never), {
        policyId: config.id,
        boundary: config.on.id,
      })
    },
    onChunk: undefined,
  }) as Constraint<B>

  return c
}

function defineLegacyConstraint<TSchema extends z.ZodType>(
  config: LegacyConstraintConfig<TSchema>,
): Constraint<TSchema> {
  const on = boundary.output.both<unknown>()
  return Object.freeze({
    _tag: 'Constraint' as const,
    id: config.name,
    on,
    category: config.category,
    severity: config.severity ?? 'assert',
    maxRetries: config.maxRetries ?? 2,
    run: async (subject: ConstraintOutput): Promise<ConstraintCheckResult> =>
      validateConstraintRunResult(await config.check(subject as ConstraintOutput<TSchema>, legacyContext()), {
        policyId: config.name,
        boundary: on.id,
      }),
    name: config.name,
    check: async (output: ConstraintOutput<TSchema>, ctx: ConstraintContext) =>
      validateConstraintRunResult(await config.check(output, ctx), {
        policyId: config.name,
        boundary: on.id,
      }),
    onChunk: config.onChunk,
  }) as unknown as Constraint<TSchema>
}

function isLegacyConstraintConfig(value: unknown): value is LegacyConstraintConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'check' in value
  )
}

function strategyMetadata(run: unknown): Constraint['strategy'] | undefined {
  if (typeof run !== 'function') return undefined
  const maybeStrategy = (run as { readonly strategy?: unknown }).strategy
  return isStrategyMetadata(maybeStrategy) ? maybeStrategy : undefined
}

function isStrategyMetadata(value: unknown): value is NonNullable<Constraint['strategy']> {
  return typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
}

function contextForConstraint<B extends BoundaryDef>(
  id: string,
  on: B,
  ctx: ConstraintContext,
): SafetyRunContext<B> {
  return {
    policy: { id, mode: 'enforce' },
    boundary: { id: on.id as never, kind: on.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: ctx.attempt, kind: ctx.attempt === 0 ? 'initial' : 'retry' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(on.path ? { path: on.path } : {}),
  }
}

function subjectForBoundary(on: BoundaryDef, output: ConstraintOutput): unknown {
  if (on.id === 'model.output.text') return output.text
  if (on.id === 'model.output.object') return on.path ? valueAtPath(output.parsed, on.path) : output.parsed
  if (on.id === 'model.output') return { text: output.text, object: output.parsed }
  return output.text
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (typeof current !== 'object' || current === null) return undefined
    return (current as Readonly<Record<string, unknown>>)[segment]
  }, value)
}

function legacyContext(): ConstraintContext {
  return {
    promptId: undefined,
    model: undefined,
    traceId: undefined,
    attempt: 0,
    metadata: {},
  }
}
