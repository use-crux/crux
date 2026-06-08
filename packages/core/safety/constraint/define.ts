import type { z } from 'zod'
import type { ConstraintConfig, Constraint } from './types'
import { captureSource } from '../../project-index/source'

/** Module-scoped map: frozen constraint → definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a constraint instance. */
export function getConstraintDefinitionSource(
  constraint: object,
): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(constraint)
}

/**
 * Define a semantic constraint for output quality validation.
 *
 * Constraints are frozen objects — define once, reuse across prompts and generate calls.
 * They validate output quality and retry with combined feedback until requirements are met.
 *
 * - `severity: 'assert'` (default) — hard fail after maxRetries, throws ConstraintViolationError
 * - `severity: 'suggest'` — best-effort, returns last attempt if retries exhausted
 *
 * For I/O safety filtering (block, redact, transform), use `guardrail()` instead.
 */
export function constraint<TSchema extends z.ZodType = z.ZodType<unknown>>(
  config: ConstraintConfig<TSchema>,
): Constraint<TSchema> {
  const defSource = captureSource()

  const constraint = Object.freeze({
    _tag: 'Constraint' as const,
    name: config.name,
    severity: config.severity ?? 'assert',
    maxRetries: config.maxRetries ?? 2,
    check: config.check,
    onChunk: config.onChunk,
  }) satisfies Constraint<TSchema>

  if (defSource) definitionSourceMap.set(constraint, defSource)

  return constraint
}

/** Runtime type guard: checks if a value is a Constraint. */
export function isConstraint(value: unknown): value is Constraint {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    '_tag' in value &&
    (value as { _tag: unknown })._tag === 'Constraint'
  )
}
