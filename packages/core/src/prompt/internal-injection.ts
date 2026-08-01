import type { z } from 'zod'
import type { Constraint } from '../safety/constraint/types'
import type { Guardrail } from '../safety/guardrail/types'
import type { ToolMiddleware } from '../tools/types'
import type { AnyToolSet } from '../types'
import type { ContextEntry } from './context-types'

/**
 * Private structural contribution shape for first-party primitives that still
 * lower through an `inject()` function.
 *
 * Public custom composition uses `contributor()` and `Contribution` instead.
 *
 * @internal
 */
export interface InternalPromptInjection {
  contexts?: readonly ContextEntry[]
  tools?: AnyToolSet
  toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  constraints?: readonly Constraint[]
  guardrails?: readonly Guardrail[]
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * Private `use:` entry contract for first-party primitives with `inject()`
 * lowering.
 *
 * @internal
 */
export interface InternalInjectableEntry {
  readonly _tag: string
  readonly id: string
  readonly inputSchema?: z.ZodType | undefined
  readonly inputKeys?: readonly string[]
  inject(args: {
    input: Record<string, unknown>
    promptId?: string
  }): InternalPromptInjection | Promise<InternalPromptInjection>
}

/** @internal Runtime guard for private `inject()`-shaped entries. */
export function isInternalInjectableEntry(value: unknown): value is InternalInjectableEntry {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    'inject' in value &&
    typeof (value as { inject?: unknown }).inject === 'function'
  )
}
