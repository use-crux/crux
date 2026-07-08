/**
 * Shared type algebra for routing wrappers.
 *
 * Runtime wrappers keep their concrete tags (`crux.router`, `crux.fallback`,
 * and so on) for simple dispatch. This module adds the compile-time phantom
 * slot that lets TypeScript carry routing context, input, streaming, prompt
 * binding, and route override keys through arbitrary wrapper composition.
 *
 * @module
 */

import type { z } from "zod";
import type { GenerationSettings } from "../generation/types";
import type { ContextEntry } from "../prompt/context-types";
import type { Prompt } from "../prompt/prompt-types";
import type { MergedInput } from "../prompt/type-utils";

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

/** Flatten an inferred object type for readable editor hovers. */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** Arguments passed to router classifiers and split seed callbacks. */
export interface RouteArgs<TCtx extends object = object, TIn = never> {
  /** Prompt input for the current generation call. */
  readonly input: TIn;
  /** Call-site routing context from the `routing:` option. */
  readonly context: TCtx;
}

/**
 * Phantom metadata carried by every routing wrapper.
 *
 * `in` is the prompt input shape read by classifiers/evaluators, `ctx` is the
 * call-site routing context, `stream` marks whether every path can stream,
 * `bound` is a prompt-bound cascade target, and `keys` are route override keys.
 */
export interface RoutingPhantom<
  TIn,
  TCtx extends object,
  TStream extends boolean,
  TBound,
  TKeys extends string,
> {
  readonly __phantom: {
    readonly in: TIn;
    readonly ctx: TCtx;
    readonly stream: TStream;
    readonly bound: TBound;
    readonly keys: TKeys;
  };
}

/** Minimal shape for a value produced by a routing wrapper factory. */
export type AnyRoutable = RoutingPhantom<
  unknown,
  object,
  boolean,
  unknown,
  string
>;

/** Per-route generation parameters wrapped around a model. */
export type CallProfile<M = unknown> = {
  /** The model or routing wrapper selected by this route. */
  readonly model: M;
} & Partial<GenerationSettings>;

/** Generation parameters carried by a {@link CallProfile}. */
export type CallProfileParams = Omit<CallProfile<unknown>, "model">;

/** Extract the underlying model from a call profile. */
export type ModelOf<T> = T extends { readonly model: infer M } ? M : T;

/** Context required by a model or routing tree. */
export type CtxOf<T> = T extends { readonly __phantom: { readonly ctx: infer C extends object } }
  ? C
  : T extends { readonly model: infer M }
    ? CtxOf<M>
    : object;

/** Prompt input shape read by a model or routing tree. */
export type InOf<T> = T extends { readonly __phantom: { readonly in: infer I } }
  ? I
  : T extends { readonly model: infer M }
    ? InOf<M>
    : never;

/** Whether a model or routing tree can be used in `stream()`. */
export type StreamOf<T> = T extends { readonly __phantom: { readonly stream: infer S extends boolean } }
  ? S
  : T extends { readonly model: infer M }
    ? StreamOf<M>
    : true;

/** Prompt binding carried by a model or routing tree. */
export type BoundOf<T> = T extends { readonly __phantom: { readonly bound: infer B } }
  ? B
  : T extends { readonly model: infer M }
    ? BoundOf<M>
    : never;

/** Top-level route override keys for a model or routing tree. */
export type KeysOf<T> = T extends { readonly __phantom: { readonly keys: infer K extends string } }
  ? K
  : never;

/** Compose a wrapper's own context with the contexts required by its children. */
export type ComposedCtx<Own extends object, Children> = Prettify<
  Own & UnionToIntersection<CtxOf<Children>>
>;

/** A composed tree is streamable only when every child is streamable. */
export type ComposedStream<Children> = false extends StreamOf<Children>
  ? false
  : true;

/** Call-site routing options required by a model or routing tree. */
export type RoutingCallOptions<M> = (
  object extends CtxOf<M>
    ? { readonly routing?: undefined }
    : { readonly routing: Prettify<CtxOf<M>> }
) &
  ([KeysOf<M>] extends [never]
    ? { readonly route?: undefined }
    : { readonly route?: KeysOf<M> });

/** Verify that a prompt input is compatible with routing callbacks. */
export type InputOk<M, PIn> = [InOf<M>] extends [never]
  ? unknown
  : PIn extends UnionToIntersection<InOf<M>>
    ? unknown
    : ["prompt input incompatible with routing input", UnionToIntersection<InOf<M>>];

/** Verify that a prompt-bound wrapper is used with its bound prompt. */
export type BoundOk<M, P> = [BoundOf<M>] extends [never]
  ? unknown
  : P extends BoundOf<M>
    ? unknown
    : ["model is bound to a different prompt", BoundOf<M>];

/** Prompt input inferred from a real Crux prompt instance. */
export type PromptInputOf<P> = P extends Prompt<infer TOwnInput, z.ZodType | undefined, infer TContexts>
  ? MergedInput<TOwnInput, TContexts>
  : never;

/** Prompt output schema carried by a real Crux prompt instance. */
export type PromptOutputSchemaOf<P> = P extends Prompt<z.ZodType, infer TOutput, readonly ContextEntry[]>
  ? TOutput
  : never;
