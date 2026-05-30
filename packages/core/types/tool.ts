import type { z } from 'zod'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[]
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

/** A creation tool that captures the entity it creates. */
export interface CreationTool<T> extends ToolDef<Record<string, unknown>, string> {
  /** The last entity created by this tool, or `undefined` if not yet called. */
  created: T | undefined
}
