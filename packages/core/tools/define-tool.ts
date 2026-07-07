/**
 * First-class tool definitions for Crux prompts and adapters.
 *
 * Tools remain plain `ToolDef` objects at runtime. The {@link tool} helper
 * exists to preserve input/output inference and give adapter packages a stable
 * authoring API to mirror.
 *
 * @module
 */

import { z } from 'zod'
import type { ToolConfig, NamedToolDef } from './types'

const emptyInputSchema = z.object({})

/**
 * Author a Crux tool definition.
 *
 * The returned object is a frozen `ToolDef` (plus an optional literal `name`),
 * so it can be dropped directly into a prompt's `tools` map or merged at the
 * adapter boundary. Input/output types are inferred from the provided Zod
 * schema and `execute` signature.
 *
 * @example
 * ```ts
 * const search = tool({
 *   name: 'search',
 *   description: 'Search the docs',
 *   input: z.object({ query: z.string() }),
 *   execute: ({ query }) => findDocs(query),
 * })
 * ```
 */
export function tool<
  TOutput,
  const TName extends string | undefined = undefined,
  const TContextSchema extends z.ZodType | undefined = undefined,
>(
  config: Omit<ToolConfig<typeof emptyInputSchema, TOutput, TName, TContextSchema>, 'input' | 'parameters'> & {
    input?: undefined
    parameters?: undefined
  },
): NamedToolDef<
  Record<string, never>,
  TOutput,
  TName,
  TContextSchema extends z.ZodType ? z.infer<TContextSchema> : never,
  TContextSchema
>
export function tool<
  const TInputSchema extends z.ZodType,
  TOutput,
  const TName extends string | undefined = undefined,
  const TContextSchema extends z.ZodType | undefined = undefined,
>(
  config: ToolConfig<TInputSchema, TOutput, TName, TContextSchema>,
): NamedToolDef<
  z.infer<TInputSchema>,
  TOutput,
  TName,
  TContextSchema extends z.ZodType ? z.infer<TContextSchema> : never,
  TContextSchema
>
export function tool<
  const TInputSchema extends z.ZodType,
  TOutput,
  const TName extends string | undefined = undefined,
  const TContextSchema extends z.ZodType | undefined = undefined,
>(
  config: ToolConfig<TInputSchema, TOutput, TName, TContextSchema>,
): NamedToolDef<
  z.infer<TInputSchema>,
  TOutput,
  TName,
  TContextSchema extends z.ZodType ? z.infer<TContextSchema> : never,
  TContextSchema
> {
  const parameters = config.parameters ?? config.input ?? emptyInputSchema
  return Object.freeze({
    ...(config.name ? { name: config.name } : {}),
    description: config.description,
    parameters,
    execute: config.execute,
    ...(config.contextSchema ? { contextSchema: config.contextSchema } : {}),
    ...(config.toModelOutput ? { toModelOutput: config.toModelOutput } : {}),
  }) as NamedToolDef<
    z.infer<TInputSchema>,
    TOutput,
    TName,
    TContextSchema extends z.ZodType ? z.infer<TContextSchema> : never,
    TContextSchema
  >
}
