import type { z } from 'zod'
import type { ContentPart } from './content'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }
export type ProviderOptions = Readonly<
  Record<string, Readonly<Record<string, JsonValue>>>
>

export type ToolModelOutput =
  | { type: 'text'; value: string; providerOptions?: ProviderOptions }
  | { type: 'json'; value: JsonValue; providerOptions?: ProviderOptions }
  | { type: 'execution-denied'; reason?: string; providerOptions?: ProviderOptions }
  | { type: 'error-text'; value: string; providerOptions?: ProviderOptions }
  | { type: 'error-json'; value: JsonValue; providerOptions?: ProviderOptions }
  | { type: 'content'; value: readonly ContentPart[] }

export interface ToModelOutputArgs<TInput, TOutput> {
  toolCallId: string
  input: TInput
  output: Awaited<TOutput>
}

/** Shared per-run context supplied to every tool invocation. */
export type ToolExecutionOptions<
  TContext = never,
  TRuntimeContext = unknown,
> = {
  /** Provider-owned tool call id for this invocation. */
  readonly toolCallId: string
  /** Current conversation history, when available to the execution path. */
  readonly messages?: readonly unknown[]
  /** Shared caller-provided context for this generation run. */
  readonly runtimeContext: TRuntimeContext
  /** Abort signal for the active tool budget, when one is available. */
  readonly abortSignal?: AbortSignal
} & ([TContext] extends [never]
  ? Record<never, never>
  : { readonly context: TContext })

/** A single tool definition compatible with AI SDK tool format. */
export interface ToolDef<
  TInput = Record<string, unknown>,
  TOutput = unknown,
  TContext = never,
  TRuntimeContext = unknown,
> {
  description: string
  parameters: z.ZodType<TInput>
  contextSchema?: z.ZodType<TContext>
  execute: (
    args: TInput,
    options: ToolExecutionOptions<TContext, TRuntimeContext>,
  ) => TOutput | Promise<TOutput>
  toModelOutput?: (args: ToModelOutputArgs<TInput, TOutput>) => ToolModelOutput | Promise<ToolModelOutput>
}

/** Structural error thrown when a creation tool has not created an entity yet. */
export type CreationToolNotCreatedError = Error & {
  readonly name: 'CreationToolNotCreatedError'
  readonly toolName?: string
}

/** Create a `CreationToolNotCreatedError`. */
export function CreationToolNotCreatedError(toolName?: string): CreationToolNotCreatedError {
  const suffix = toolName ? ` for "${toolName}"` : ''
  return Object.assign(Error(`Creation tool has not created an entity${suffix}.`), {
    name: 'CreationToolNotCreatedError' as const,
    toolName,
  })
}

/** Return whether an unknown thrown value is a `CreationToolNotCreatedError`. */
export function isCreationToolNotCreatedError(error: unknown): error is CreationToolNotCreatedError {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'CreationToolNotCreatedError'
}

/**
 * A creation tool that captures the last entity it creates.
 *
 * Call `created()` after tool execution to retrieve the captured entity. It
 * throws `CreationToolNotCreatedError` when no entity has been created yet,
 * avoiding unsafe non-null assertions against captured creation state.
 */
export interface CreationTool<T> extends ToolDef<Record<string, unknown>, string> {
  /** Return the last entity created by this tool. */
  created(): T
}
