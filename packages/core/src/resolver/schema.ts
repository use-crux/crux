/**
 * Schema utilities for the prompt compiler boundary.
 *
 * Prompt compilation merges input schemas at definition time, while
 * resolution uses the same helpers for validation and shallow inspect
 * previews. Keeping those concerns together prevents schema-shape logic from
 * drifting between compile-time and resolve-time paths.
 *
 * @module
 */

import { z } from 'zod'
import type { ContextEntry } from '../prompt/context-types'
import { collectSchemaContributions, schemaContributionSource } from './schema-collection'

/** Result shape returned by Zod's `safeParse` for resolve-time validation. */
export interface SafeParseResult {
  success: boolean
  data?: unknown
  error?: { issues?: readonly unknown[] }
}

/**
 * Run `safeParse` on an arbitrary schema-like value.
 *
 * Some tests and advanced callers provide schema doubles that pre-validate
 * elsewhere. Those values may not expose Zod's `safeParse` method, so the
 * prompt compiler treats them as pass-through schemas instead of failing
 * before user code can run.
 */
export function safeParseSchema(schema: z.ZodType, input: unknown): SafeParseResult {
  const candidate = schema as { safeParse?: (value: unknown) => SafeParseResult }
  if (typeof candidate.safeParse !== 'function') {
    return { success: true, data: input }
  }
  return candidate.safeParse(input)
}

/**
 * Compile a prompt's effective input schema.
 *
 * Context and contributor schemas are merged first with duplicate key
 * detection. Prompt-owned fields are applied last so callers can intentionally
 * narrow or optionalize context-provided fields at the prompt boundary.
 */
export function compileInputSchema(
  entries: readonly ContextEntry[],
  ownInput: z.ZodType | undefined,
): z.ZodType | undefined {
  const seenKeys = new Map<string, { label: string; source: object | undefined }>()
  let mergedShape: Record<string, z.ZodType> = {}

  const contributions = collectSchemaContributions(entries)

  for (let i = 0; i < contributions.length; i++) {
    const { id, schema, optional } = contributions[i]
    if (!schema) continue

    const shape = schema instanceof z.ZodObject ? schema.shape : undefined
    if (!shape || typeof shape !== 'object') continue

    for (const key of Object.keys(shape)) {
      const source = id ?? `context[${i}]`
      const sourceIdentity = schemaContributionSource(contributions[i])
      const existing = seenKeys.get(key)
      if (existing) {
        if (existing.source && existing.source === sourceIdentity) {
          if (!optional) {
            mergedShape[key] = shape[key]
          }
          continue
        }
        throw new Error(
          `Input key "${key}" is defined by both "${existing.label}" and "${source}". ` +
            `Context input keys must not overlap.`,
        )
      }
      seenKeys.set(key, { label: source, source: sourceIdentity })
      mergedShape[key] = optional ? shape[key].optional() : shape[key]
    }
  }

  if (ownInput) {
    const ownShape = ownInput instanceof z.ZodObject ? ownInput.shape : undefined
    if (ownShape && typeof ownShape === 'object') {
      mergedShape = { ...mergedShape, ...ownShape }
    }
  }

  if (Object.keys(mergedShape).length === 0) return ownInput
  return z.object(mergedShape)
}

/**
 * Returns the top-level keys declared by an object schema, or an empty list for
 * schemas that cannot be compared as prompt input fields.
 */
export function promptInputSchemaKeys(schema: z.ZodType): readonly string[] {
  const shape = schema instanceof z.ZodObject ? schema.shape : undefined
  return shape && typeof shape === 'object' ? Object.keys(shape).sort() : []
}

/**
 * Infers required top-level keys using each field schema's parse behavior.
 *
 * This stays aligned with Zod modifiers such as optional, default, nullable,
 * and effects without depending on their internal classes.
 */
export function promptInputRequiredKeys(schema: z.ZodType): readonly string[] {
  const shape = schema instanceof z.ZodObject ? schema.shape : undefined
  if (!shape || typeof shape !== 'object') return []
  return Object.entries(shape)
    .filter(([, value]) => !safeParseSchema(value as z.ZodType, undefined).success)
    .map(([key]) => key)
    .sort()
}
