import type { z } from 'zod'

type ZodObjectShapeLike = {
  readonly shape?: unknown
  readonly _zod?: {
    readonly shape?: unknown
  }
}

/**
 * Read the top-level keys of a Zod object schema.
 *
 * Crux supports both Zod v3 (`schema.shape`) and Zod v4 (`schema._zod.shape`)
 * for input-key conflict detection. Non-object schemas return an empty list.
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
