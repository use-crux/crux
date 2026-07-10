/**
 * Prompt content-mode type helpers.
 *
 * Kept separate from `prompt-types.ts` so the main prompt contract file can
 * focus on config, hooks, and prompt instances while this module owns the
 * `system`/`prompt` versus `messages` discriminated union.
 *
 * @module
 */

import type { ContextSystemContent, ContextSystemResult } from './context-types'
import type { AnyMessage } from '../types'

export type PromptCallback<TArgs extends readonly unknown[], TResult> = {
  fn(...args: TArgs): TResult
}['fn']

/** System message field accepted by the `system`/`prompt` content mode. */
export type SystemField<TArg> =
  | string
  | ContextSystemContent
  | PromptCallback<[arg: TArg], ContextSystemResult | Promise<ContextSystemResult>>

/** User prompt field accepted by the `system`/`prompt` content mode. */
export type PromptField<TArg> = string | PromptCallback<[arg: TArg], string>

/**
 * Prompt content mode.
 *
 * A prompt is either authored as `system`/`prompt` fields or as a `messages`
 * callback. The runtime still validates this for untyped callers, but typed
 * callers get the invalid combinations rejected at compile time.
 */
export type PromptContent<TArg> =
  | {
      /**
       * System message — role/identity text that appears first.
       * Mutually exclusive with `messages`.
       */
      system?: SystemField<TArg>
      /**
       * User prompt text.
       * Mutually exclusive with `messages`.
       */
      prompt?: PromptField<TArg>
      messages?: never
    }
  | {
      system?: never
      prompt?: never
      /**
       * Multi-turn / few-shot messages array. Context system text is prepended
       * to the first system message (or inserted at the start).
       * Mutually exclusive with `system` and `prompt`.
       */
      messages: PromptCallback<[arg: TArg], AnyMessage[]>
    }
