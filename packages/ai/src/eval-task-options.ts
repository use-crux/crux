/**
 * Type projections for reusable managed AI task options.
 *
 * @internal
 * @module
 */

import type { ToolSet } from "ai";
import type { z } from "zod";
import type {
  AnyPrompt,
  AnyToolSet,
  ContextEntry,
  Prompt,
} from "@use-crux/core";
import type { BoundOk, InputOk, PromptInputOf } from "@use-crux/core/routing";
import type { AIGenerateOptions, AISupportedModel } from "./options";

/** Input-independent production options accepted by a managed task call. */
export type AIGenerateTaskCall<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
  TCallTools extends ToolSet | undefined,
  TPrompt extends Prompt<
    TOwnInput,
    z.ZodType | undefined,
    TContexts,
    AnyToolSet | undefined
  >,
  TRuntimeContext,
  TModel,
> = Omit<
  AIGenerateOptions<
    TOwnInput,
    TContexts,
    TCallTools,
    TPrompt,
    TRuntimeContext,
    TModel
  >,
  "input"
>;

/** Reusable task defaults, excluding one-shot caller cancellation. */
export type AIGenerateTaskDefaults<
  TOwnInput extends z.ZodType,
  TContexts extends readonly ContextEntry[],
  TCallTools extends ToolSet | undefined,
  TPrompt extends Prompt<
    TOwnInput,
    z.ZodType | undefined,
    TContexts,
    AnyToolSet | undefined
  >,
  TRuntimeContext,
  TModel,
> = Omit<
  AIGenerateTaskCall<
    TOwnInput,
    TContexts,
    TCallTools,
    TPrompt,
    TRuntimeContext,
    TModel
  >,
  "signal"
>;

/** Flatten an inferred option intersection at the public callable boundary. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Remaining per-call options after exact task defaults have been bound. */
export type AIGenerateTaskCallOptions<
  TCall extends object,
  TDefaults extends object,
> = Simplify<
  Omit<TCall, keyof TDefaults> &
    Partial<Pick<TCall, Extract<keyof TDefaults, keyof TCall>>>
>;

/** Validate only the keys a caller binds as reusable task defaults. */
export type ValidateTaskDefaults<
  TDefaults extends object,
  TCall extends object,
> = {
  [K in keyof TDefaults]: K extends keyof TCall ? TCall[K] : never;
};

/** Model or routing tree bound by the exact defaults object. */
export type TaskModel<TDefaults extends object> = TDefaults extends {
  readonly model: infer TModel extends AISupportedModel;
}
  ? TModel
  : AISupportedModel;

/** Call-Tool surface bound by defaults, or the open call-site surface. */
export type TaskCallTools<TDefaults extends object> = TDefaults extends {
  readonly tools: infer TTools extends ToolSet;
}
  ? TTools
  : ToolSet | undefined;

/** Runtime context bound by defaults when one is authored. */
export type TaskRuntimeContext<TDefaults extends object> = TDefaults extends {
  readonly runtimeContext: infer TRuntimeContext;
}
  ? TRuntimeContext
  : unknown;

/** Prompt compatibility retained while a task's model is inferred. */
export type StructuredPromptForModel<P extends AnyPrompt, M> = P &
  BoundOk<M, P> &
  InputOk<M, PromptInputOf<P>>;
