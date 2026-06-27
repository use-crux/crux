/**
 * Prompt/context type-level inference helpers.
 *
 * These types power the compile-time guarantee that a prompt's `input`
 * argument is the intersection of its own schema and every context it
 * `use`s — required fields from plain contexts, optional fields from
 * `when()`-wrapped contexts. They are erased at runtime; the matching
 * runtime merge lives in the resolver.
 *
 * @module
 */

import type { z } from 'zod'
import type { Context, ContextEntry, ConditionalContext, ContributorEntry } from './context-types'

/** Flatten intersection types into a single object for clean IDE tooltips. */
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

/** Recursively marks all properties as `readonly`, preserving `Context` leaf types. */
export type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends Context<z.ZodType> ? T[K] : DeepReadonly<T[K]>
}

/** Extract inferred type from a Context's input, or `{}` if no input declared. */
type InferContextInput<C> = C extends Context<infer S> ? (S extends z.ZodType ? z.infer<S> : {}) : {}

/**
 * Extract inferred type from a ContextEntry.
 *
 * - `Context<T>` → required (`z.infer<T>`)
 * - `ConditionalContext<Context<T>>` → optional (`Partial<z.infer<T>>`)
 * - `ContributorEntry<T>` → required (`z.infer<T>`; contributors declare schemas like injectables)
 * - `MatchSpec` → `{}` (no type-level contribution; declare fields on prompt input)
 * - `false | null | undefined` → `{}` (filtered out at runtime)
 */
type InferContextEntryInput<E> =
  E extends Context<z.ZodType>
    ? InferContextInput<E>
    : E extends ConditionalContext<infer TCtx>
      ? Partial<InferContextInput<TCtx>>
      : E extends ContributorEntry<infer S>
        ? S extends z.ZodType
          ? z.infer<S>
          : {}
        : {} // MatchSpec, false, null, undefined

/**
 * Recursively intersect all context entry input types from a tuple.
 *
 * Handles the widened `ContextEntry` union: plain contexts contribute required
 * keys, conditional contexts contribute optional keys, and falsy/match entries
 * contribute nothing.
 *
 * @example
 * Given `[Context<{a: string}>, ConditionalContext<Context<{b: number}>>]`,
 * produces `{a: string} & {b?: number}`.
 */
export type MergeContextInputs<T extends readonly ContextEntry[]> = T extends readonly [
  infer First,
  ...infer Rest extends readonly ContextEntry[],
]
  ? InferContextEntryInput<First> & MergeContextInputs<Rest>
  : {}

/**
 * The final merged input type for a prompt: its own input intersected
 * with all context inputs, flattened via `Simplify` for clean IDE display.
 */
export type MergedInput<TOwnInput extends z.ZodType, TContexts extends readonly ContextEntry[]> = Simplify<
  z.infer<TOwnInput> & MergeContextInputs<TContexts>
>
