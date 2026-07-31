/**
 * View predicate typing and normalization for connected knowledge.
 *
 * @module
 */

import { z } from 'zod'

type Scalar = string | number | boolean
type ScalarKeys<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends Scalar ? K : never
}[keyof T]

/** AND of exact scalar matches. Array values mean membership (IN). */
export type WhereClause<T> = {
  [K in ScalarKeys<T>]?: NonNullable<T[K]> | readonly NonNullable<T[K]>[]
}

/** V1 view selection: one clause, or a union of compound clauses. */
export type ViewWhere<T> = WhereClause<T> | { any: readonly WhereClause<T>[] }

export type ViewWhereValidationCode =
  | 'empty_any'
  | 'empty_clause'
  | 'invalid_shape'
  | 'invalid_value'
  | 'non_scalar_field'
  | 'non_scalar_value'
  | 'unknown_field'

/** Runtime validation failure for a view where predicate. */
export class ViewWhereValidationError extends Error {
  readonly code: ViewWhereValidationCode
  readonly field?: string

  constructor(code: ViewWhereValidationCode, message: string, field?: string) {
    super(message)
    this.name = 'ViewWhereValidationError'
    this.code = code
    this.field = field
  }
}

export interface NormalizedWhereTerm {
  readonly field: string
  readonly values: readonly Scalar[]
}

export type NormalizedWhereClause = readonly NormalizedWhereTerm[]

export interface NormalizedViewWhere {
  readonly any: readonly NormalizedWhereClause[]
}

/** Validate and canonicalize a view where predicate for stable hashing. */
export function normalizeViewWhere<TSchema extends z.ZodObject<z.ZodRawShape>>(
  where: ViewWhere<z.infer<TSchema>>,
  schema: TSchema,
): NormalizedViewWhere {
  const shape = schema.shape as Record<string, z.ZodType<unknown>>
  const input = where as unknown
  if (!isRecord(input)) {
    throw new ViewWhereValidationError('invalid_shape', 'View where must be an object.')
  }

  const clauses = isAnyUnion(input)
    ? normalizeAny(input, shape)
    : [normalizeClause(input, shape)]
  return {
    any: dedupeClauses(clauses).sort(compareClauses),
  }
}

function normalizeAny(input: Record<string, unknown>, shape: Record<string, z.ZodType<unknown>>): NormalizedWhereClause[] {
  if (Object.keys(input).length !== 1) {
    throw new ViewWhereValidationError('invalid_shape', 'View where any union cannot include sibling fields.')
  }
  const clauses = input.any
  if (!Array.isArray(clauses) || clauses.length === 0) {
    throw new ViewWhereValidationError('empty_any', 'View where any union must include at least one clause.')
  }
  return clauses.map((clause) => {
    if (!isRecord(clause)) {
      throw new ViewWhereValidationError('invalid_shape', 'View where any union clauses must be objects.')
    }
    return normalizeClause(clause, shape)
  })
}

function normalizeClause(input: Record<string, unknown>, shape: Record<string, z.ZodType<unknown>>): NormalizedWhereClause {
  const terms = Object.keys(input)
    .sort()
    .map((field) => normalizeTerm(field, input[field], shape))
  if (terms.length === 0) {
    throw new ViewWhereValidationError('empty_clause', 'View where clauses must reference at least one scalar field.')
  }
  return terms
}

function normalizeTerm(
  field: string,
  value: unknown,
  shape: Record<string, z.ZodType<unknown>>,
): NormalizedWhereTerm {
  const fieldSchema = shape[field]
  if (!fieldSchema) {
    throw new ViewWhereValidationError('unknown_field', `View where field "${field}" is not in metadataSchema.`, field)
  }
  if (!isScalarSchema(fieldSchema)) {
    throw new ViewWhereValidationError('non_scalar_field', `View where field "${field}" is not scalar metadata.`, field)
  }

  const values = Array.isArray(value) ? value : [value]
  const normalizedValues = values.map((entry) => {
    if (!isScalar(entry)) {
      throw new ViewWhereValidationError('non_scalar_value', `View where field "${field}" must use scalar values.`, field)
    }
    if (!fieldSchema.safeParse(entry).success) {
      throw new ViewWhereValidationError(
        'invalid_value',
        `View where field "${field}" value does not match metadataSchema.`,
        field,
      )
    }
    return entry
  })

  return {
    field,
    values: dedupeScalars(normalizedValues).sort(compareScalars),
  }
}

function dedupeScalars(values: readonly Scalar[]): Scalar[] {
  const seen = new Set<string>()
  const result: Scalar[] = []
  for (const value of values) {
    const key = scalarKey(value)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

function dedupeClauses(clauses: readonly NormalizedWhereClause[]): NormalizedWhereClause[] {
  const seen = new Set<string>()
  const result: NormalizedWhereClause[] = []
  for (const clause of clauses) {
    const key = clauseKey(clause)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clause)
  }
  return result
}

function isAnyUnion(input: Record<string, unknown>): boolean {
  return Array.isArray(input.any)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isScalar(value: unknown): value is Scalar {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}

function isScalarSchema(schema: z.ZodType<unknown>): boolean {
  const def = schema.def as { readonly type?: string, readonly innerType?: z.ZodType<unknown>, readonly values?: Set<unknown> }
  if (def.type === 'string' || def.type === 'number' || def.type === 'boolean' || def.type === 'enum') return true
  if (def.type === 'literal') return Array.from(def.values ?? []).every(isScalar)
  if ((def.type === 'optional' || def.type === 'nullable' || def.type === 'default' || def.type === 'catch') && def.innerType) {
    return isScalarSchema(def.innerType)
  }
  return false
}

function compareScalars(left: Scalar, right: Scalar): number {
  return scalarKey(left).localeCompare(scalarKey(right))
}

function compareClauses(left: NormalizedWhereClause, right: NormalizedWhereClause): number {
  return clauseKey(left).localeCompare(clauseKey(right))
}

function clauseKey(clause: NormalizedWhereClause): string {
  return clause.map((term) => `${term.field}=${term.values.map(scalarKey).join('|')}`).join('&')
}

function scalarKey(value: Scalar): string {
  return `${typeof value}:${String(value)}`
}
