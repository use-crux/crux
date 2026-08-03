import type { z } from 'zod'
import type { ContextDef } from './context-types'

const INTERNAL_FULL_PROMPT_INPUT = Symbol.for('crux.context.fullPromptInput')

export type InternalFullPromptInputDef = ContextDef<z.ZodType<Record<string, unknown>>> & {
  readonly [INTERNAL_FULL_PROMPT_INPUT]?: true
}

/** @internal Mark an SDK-owned context adapter as consuming full prompt input. */
export function withFullPromptInput(
  def: Omit<ContextDef<z.ZodType<Record<string, unknown>>>, 'input' | 'rawFields' | 'escapeFields' | 'memo'>,
): ContextDef<z.ZodType<Record<string, unknown>>> {
  return {
    ...def,
    [INTERNAL_FULL_PROMPT_INPUT]: true,
  } as ContextDef<z.ZodType<Record<string, unknown>>>
}

/** @internal Whether this context definition consumes full prompt input. */
export function consumesFullPromptInput(def: object): boolean {
  return (def as InternalFullPromptInputDef)[INTERNAL_FULL_PROMPT_INPUT] === true
}
