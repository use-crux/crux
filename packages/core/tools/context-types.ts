/**
 * Type helpers for per-tool execution context.
 *
 * A tool's `contextSchema` declares the data that must be supplied at
 * generation time under `toolsContext.<toolName>`. These helpers derive that
 * mapped object from known prompt and call-site tool maps.
 *
 * @module
 */

import type { z } from 'zod'
import type { ContextEntry } from '../prompt/context-types'
import type { Prompt } from '../prompt/prompt-types'

type EmptyToolSet = Record<never, never>

/** Infer the context value declared by one tool's `contextSchema`. */
export type ToolContextOf<TTool> = TTool extends {
  readonly contextSchema?: infer TSchema
}
  ? TSchema extends z.ZodType
    ? z.infer<TSchema>
    : never
  : never

/** Build the generation-time `toolsContext` object for a statically known tool map. */
export type ToolsContextOf<TTools> = [TTools] extends [never]
  ? EmptyToolSet
  : TTools extends Record<string, unknown>
  ? {
      readonly [K in keyof TTools as [ToolContextOf<TTools[K]>] extends [never] ? never : K]: ToolContextOf<TTools[K]>
    }
  : EmptyToolSet

/** Extract the static tool map carried by a prompt instance. */
export type PromptToolsOf<TPrompt> = TPrompt extends Prompt<
  z.ZodType,
  z.ZodType | undefined,
  readonly ContextEntry[],
  infer TTools
>
  ? TTools
  : undefined

type ToolSetObject<TTools> = [TTools] extends [never]
  ? EmptyToolSet
  : TTools extends Record<string, unknown>
    ? TTools
    : EmptyToolSet

/** Merge prompt-level and call-site tools using the runtime override rule. */
export type MergeKnownTools<TPromptTools, TCallTools> = Omit<
  ToolSetObject<TPromptTools>,
  keyof ToolSetObject<TCallTools>
> &
  ToolSetObject<TCallTools>

/** Known tools for one generation call, combining prompt and call-site maps. */
export type KnownToolsFor<TPrompt, TCallTools> = MergeKnownTools<
  PromptToolsOf<TPrompt>,
  TCallTools
>

/** Conditionally require `toolsContext` when any known tool declares a schema. */
export type ToolsContextOption<TTools> = [keyof ToolsContextOf<TTools>] extends [never]
  ? { readonly toolsContext?: undefined }
  : { readonly toolsContext: ToolsContextOf<TTools> }
