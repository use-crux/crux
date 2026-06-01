/**
 * First-class tool definitions for Crux prompts and adapters.
 *
 * Tools remain plain `ToolDef` objects at runtime. The `tool()` helper exists
 * to preserve input/output inference and give adapter packages a stable authoring
 * API to mirror.
 *
 * @module
 */

import { z } from 'zod'
import type { ToolDef, ToolModelOutput, ToModelOutputArgs } from './types/tool'

const emptyInputSchema = z.object({})

export interface ToolConfig<TInputSchema extends z.ZodType, TOutput, TName extends string | undefined = string | undefined> {
  /**
   * Optional stable name used by adapters that need named registries.
   * Prompt-level tool objects still use their object key as the canonical name.
   */
  name?: TName
  description: string
  input?: TInputSchema
  parameters?: TInputSchema
  execute: (input: z.infer<TInputSchema>) => TOutput | Promise<TOutput>
  toModelOutput?: (
    args: ToModelOutputArgs<z.infer<TInputSchema>, TOutput>,
  ) => ToolModelOutput | Promise<ToolModelOutput>
}

export type NamedToolDef<TInput, TOutput, TName extends string | undefined = string | undefined> = ToolDef<
  TInput,
  TOutput
> & {
  readonly name?: TName
}

export function tool<TOutput, const TName extends string | undefined = undefined>(
  config: Omit<ToolConfig<typeof emptyInputSchema, TOutput, TName>, 'input' | 'parameters'> & {
    input?: undefined
    parameters?: undefined
  },
): NamedToolDef<Record<string, never>, TOutput, TName>
export function tool<const TInputSchema extends z.ZodType, TOutput, const TName extends string | undefined = undefined>(
  config: ToolConfig<TInputSchema, TOutput, TName>,
): NamedToolDef<z.infer<TInputSchema>, TOutput, TName>
export function tool<const TInputSchema extends z.ZodType, TOutput, const TName extends string | undefined = undefined>(
  config: ToolConfig<TInputSchema, TOutput, TName>,
): NamedToolDef<z.infer<TInputSchema>, TOutput, TName> {
  const parameters = config.parameters ?? config.input ?? emptyInputSchema
  return Object.freeze({
    ...(config.name ? { name: config.name } : {}),
    description: config.description,
    parameters,
    execute: config.execute,
    ...(config.toModelOutput ? { toModelOutput: config.toModelOutput } : {}),
  }) as NamedToolDef<z.infer<TInputSchema>, TOutput, TName>
}

export type { ToolDef, ToolModelOutput, ToModelOutputArgs } from './types/tool'
