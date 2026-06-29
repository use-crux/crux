import type { z } from 'zod'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }
export type ProviderOptions = Record<string, { readonly [key: string]: JsonValue }>

export type ToolContentPart =
  | { type: 'text'; text: string; providerOptions?: ProviderOptions }
  | { type: 'media'; data: string; mediaType: string }
  | { type: 'file-data'; data: string; mediaType: string; filename?: string; providerOptions?: ProviderOptions }
  | { type: 'file-url'; url: string; providerOptions?: ProviderOptions }
  | { type: 'file-id'; fileId: string | Record<string, string>; providerOptions?: ProviderOptions }
  | { type: 'image-data'; data: string; mediaType: string; providerOptions?: ProviderOptions }
  | { type: 'image-url'; url: string; providerOptions?: ProviderOptions }
  | { type: 'image-file-id'; fileId: string | Record<string, string>; providerOptions?: ProviderOptions }
  | { type: 'custom'; providerOptions?: ProviderOptions }

export type ToolModelOutput =
  | { type: 'text'; value: string; providerOptions?: ProviderOptions }
  | { type: 'json'; value: JsonValue; providerOptions?: ProviderOptions }
  | { type: 'execution-denied'; reason?: string; providerOptions?: ProviderOptions }
  | { type: 'error-text'; value: string; providerOptions?: ProviderOptions }
  | { type: 'error-json'; value: JsonValue; providerOptions?: ProviderOptions }
  | { type: 'content'; value: readonly ToolContentPart[] }

export interface ToModelOutputArgs<TInput, TOutput> {
  toolCallId: string
  input: TInput
  output: Awaited<TOutput>
}

/** A single tool definition compatible with AI SDK tool format. */
export interface ToolDef<TInput = Record<string, unknown>, TOutput = unknown> {
  description: string
  parameters: z.ZodType<TInput>
  execute: (args: TInput) => TOutput | Promise<TOutput>
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
 * avoiding non-null assertions like `tool.created!`.
 */
export interface CreationTool<T> extends ToolDef<Record<string, unknown>, string> {
  /** Return the last entity created by this tool. */
  created(): T
}
