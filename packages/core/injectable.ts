import type { z } from 'zod'
import type { InjectableEntry, PromptInjection } from './types'

type ZodObjectShapeLike = {
  readonly shape?: unknown
  readonly _zod?: {
    readonly shape?: unknown
  }
}

export interface InjectableConfig {
  id: string
  input?: z.ZodType
  inject(args: { input: Record<string, unknown>; promptId?: string }): PromptInjection | Promise<PromptInjection>
}

export function injectable(config: InjectableConfig): InjectableEntry {
  if (!config.id.trim()) {
    throw new Error('injectable(): id must be non-empty.')
  }

  const inputKeys: string[] = []
  if (config.input) {
    inputKeys.push(...getInputShapeKeys(config.input))
  }

  return Object.freeze({
    _tag: 'Injectable' as const,
    id: config.id,
    inputSchema: config.input,
    inputKeys: Object.freeze(inputKeys),
    inject: config.inject,
  })
}

/**
 * Read the top-level keys of a Zod object schema, tolerating both Zod v3
 * (`schema.shape`) and v4 (`schema._zod.shape`) internals. Returns `[]` for
 * non-object schemas. Shared by `injectable()` and `contributor()` for
 * input-key conflict detection.
 */
export function getInputShapeKeys(input: z.ZodType): string[] {
  const schema = input as unknown as ZodObjectShapeLike
  const shape = schema._zod?.shape ?? schema.shape
  if (!isObjectRecord(shape)) return []
  return Object.keys(shape)
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isInjectableEntry(value: unknown): value is InjectableEntry {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'inject' in value &&
    typeof (value as { inject?: unknown }).inject === 'function'
  )
}
