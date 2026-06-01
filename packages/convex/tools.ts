/**
 * Convex runtime profile for Crux tools.
 *
 * The public shape mirrors `@crux/core/tools`, with Convex runtime metadata
 * made available to the execute function.
 *
 * @module
 */

import { z } from 'zod'
import type { NamedToolDef, ToolDef, ToolModelOutput, ToModelOutputArgs } from '@crux/core/tools'
import { getConvexCruxRuntime, type ConvexCruxRuntime, type ConvexRuntimeTarget } from './runtime'

const emptyInputSchema = z.object({})

export interface ConvexToolExecuteArgs<
  TInput,
  TCtx = unknown,
  TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
> {
  input: TInput
  ctx: TCtx
  target: TTarget
  runtime: ConvexCruxRuntime<TCtx, TTarget>
  toolCallId?: string
}

export interface ConvexToolConfig<
  TInputSchema extends z.ZodType,
  TOutput,
  TName extends string | undefined = string | undefined,
  TCtx = unknown,
  TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
> {
  name?: TName
  description: string
  input?: TInputSchema
  parameters?: TInputSchema
  execute: (args: ConvexToolExecuteArgs<z.infer<TInputSchema>, TCtx, TTarget>) => TOutput | Promise<TOutput>
  toModelOutput?: (
    args: ToModelOutputArgs<z.infer<TInputSchema>, TOutput>,
  ) => ToolModelOutput | Promise<ToolModelOutput>
}

export type ConvexToolDef<
  TInput,
  TOutput,
  TName extends string | undefined = string | undefined,
> = NamedToolDef<TInput, TOutput, TName>

export function tool<
  TOutput,
  const TName extends string | undefined = undefined,
  TCtx = unknown,
  TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
>(
  config: Omit<ConvexToolConfig<typeof emptyInputSchema, TOutput, TName, TCtx, TTarget>, 'input' | 'parameters'> & {
    input?: undefined
    parameters?: undefined
  },
): ConvexToolDef<Record<string, never>, TOutput, TName>
export function tool<
  const TInputSchema extends z.ZodType,
  TOutput,
  const TName extends string | undefined = undefined,
  TCtx = unknown,
  TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
>(
  config: ConvexToolConfig<TInputSchema, TOutput, TName, TCtx, TTarget>,
): ConvexToolDef<z.infer<TInputSchema>, TOutput, TName>
export function tool<
  const TInputSchema extends z.ZodType,
  TOutput,
  const TName extends string | undefined = undefined,
  TCtx = unknown,
  TTarget extends ConvexRuntimeTarget = ConvexRuntimeTarget,
>(
  config: ConvexToolConfig<TInputSchema, TOutput, TName, TCtx, TTarget>,
): ConvexToolDef<z.infer<TInputSchema>, TOutput, TName> {
  const parameters = config.parameters ?? config.input ?? emptyInputSchema
  const execute: ToolDef<z.infer<TInputSchema>, TOutput>['execute'] = (input) => {
    const runtime = getConvexCruxRuntime()
    if (!runtime) {
      throw new Error('Convex tool execution requires an active Convex Crux runtime.')
    }
    return config.execute({
      input,
      ctx: runtime.ctx as TCtx,
      target: (runtime.target ?? {}) as TTarget,
      runtime: runtime as ConvexCruxRuntime<TCtx, TTarget>,
      toolCallId: typeof runtime.target?.toolCallId === 'string' ? runtime.target.toolCallId : undefined,
    })
  }
  return Object.freeze({
    ...(config.name ? { name: config.name } : {}),
    description: config.description,
    parameters,
    execute,
    ...(config.toModelOutput ? { toModelOutput: config.toModelOutput } : {}),
  }) as ConvexToolDef<z.infer<TInputSchema>, TOutput, TName>
}

export type { NamedToolDef, ToolConfig, ToolDef, ToolModelOutput, ToModelOutputArgs } from '@crux/core/tools'
