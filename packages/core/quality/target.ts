/**
 * Tasks and targets for the v1 Quality authoring surface.
 *
 * A **task** is the thing under evaluation — any Crux primitive (prompt, flow,
 * agent, retriever), a `target.*`-wrapped primitive, or a plain function. The
 * task anchors ALL type inference in `evaluate()`: case inputs, `ctx.output`,
 * variant parameters, and capability-gated assertions all derive from it.
 *
 * A **target** is a parameterized, signal-capturing task: use `target.*` only
 * to set execution defaults (model, settings, tool mocks) or to unlock typed
 * variant parameters. Bare primitives passed to `task:` behave exactly as
 * `target.<kind>(primitive)` with no defaults.
 *
 * @module
 */

import type { z } from 'zod'
import type {
  ContextEntry,
  GenerationSettings,
  MergeContextInputs,
  Prompt,
  AnyPrompt,
  Simplify,
} from '../types'
import type { Agent, AnyAgent } from '../agent/agent'
import type { FlowHandle } from '../flow/types'
import type { Retriever, RetrieveOptions, RetrieverHit } from '../retrieval'

// ─────────────────────────────────────────────────────────────────
// Capabilities
// ─────────────────────────────────────────────────────────────────

/**
 * A trace signal family a task can capture. Capabilities drive which
 * `expect.*` namespaces exist at compile time and which signals the runner
 * records. `latency`, `cost`, and `errors` are NOT capabilities — every
 * execution captures them and their namespaces always exist.
 *
 * Capability sets are fixed per task kind in v1: prompts capture
 * `modelCalls`/`citations`/`safety`; flows add `steps`/`toolCalls`/`routing`/
 * `memory`; agents capture all nine; retrievers capture `retrieval`; plain
 * functions capture none (value matchers + always-on namespaces only).
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportAgent,
 *   data: cases,
 *   expect: (ctx) => {
 *     ctx.expect.toolCalls.toHaveCalled('lookupOrder') // agent captures toolCalls
 *   },
 * })
 * ```
 */
export type Capability =
  | 'modelCalls' // model invocations: model id, fallbacks, settings
  | 'toolCalls' // tool invocations with args/results
  | 'steps' // named flow/agent steps
  | 'handoffs' // sub-agent delegation
  | 'retrieval' // retriever hits
  | 'citations' // resolved citations / grounding
  | 'safety' // guardrail + constraint outcomes
  | 'memory' // memory reads/writes
  | 'routing' // route/tier/model selection decisions

/** The capability set of a prompt task. */
export type PromptCapability = 'modelCalls' | 'citations' | 'safety'

/** The capability set of a flow task. */
export type FlowCapability = 'modelCalls' | 'steps' | 'toolCalls' | 'routing' | 'safety' | 'memory'

/** The capability set of an agent task — all nine families. */
export type AgentCapability = Capability

/** The capability set of a retriever task. */
export type RetrieverCapability = 'retrieval'

/** Runtime capability set for prompt tasks. @internal */
export const PROMPT_CAPABILITIES: readonly PromptCapability[] = Object.freeze(['modelCalls', 'citations', 'safety'])

/** Runtime capability set for flow tasks. @internal */
export const FLOW_CAPABILITIES: readonly FlowCapability[] = Object.freeze([
  'modelCalls',
  'steps',
  'toolCalls',
  'routing',
  'safety',
  'memory',
])

/** Runtime capability set for agent tasks. @internal */
export const AGENT_CAPABILITIES: readonly AgentCapability[] = Object.freeze([
  'modelCalls',
  'toolCalls',
  'steps',
  'handoffs',
  'retrieval',
  'citations',
  'safety',
  'memory',
  'routing',
])

/** Runtime capability set for retriever tasks. @internal */
export const RETRIEVER_CAPABILITIES: readonly RetrieverCapability[] = Object.freeze(['retrieval'])

// ─────────────────────────────────────────────────────────────────
// Adapter bridge types
// ─────────────────────────────────────────────────────────────────

/**
 * A reference to a model, in adapter-native form.
 *
 * Crux core is SDK-agnostic, so a model reference is opaque here: pass the
 * exact value your eval-local adapter `generate` accepts (an AI SDK
 * `LanguageModel`, an OpenRouter id string, and so on).
 *
 * @example
 * ```ts
 * evaluate({
 *   task: supportPrompt,
 *   data: cases,
 *   variants: { cheap: { model: openrouter('openai/gpt-5-mini') } },
 * })
 * ```
 */
export type ModelRef = unknown

/**
 * SDK-agnostic generation settings (temperature, maxTokens, topP, …).
 * Identical to the prompt-level {@link GenerationSettings} — adapters map
 * these to their SDK's field names.
 */
export type ModelSettings = GenerationSettings

/**
 * The abstract adapter `generate` bridge for model-backed tasks.
 *
 * Each adapter (e.g. `generate` from `@use-crux/ai`) narrows the prompt and
 * options to its own SDK types; quality runners accept any adapter through
 * this signature. Both parameters are typed `never` because no single
 * concrete type can satisfy every adapter contravariantly (adapters constrain
 * their prompt generics differently) — the engine forwards both opaquely and
 * never constructs them from this type. Do not call a `GenerateFn` directly;
 * pass it to `target.*` defaults, `params`, or `variants` from eval code or
 * a small eval-local helper module.
 *
 * @example
 * ```ts
 * import { generate } from '@use-crux/ai'
 * import { openrouter } from '@openrouter/ai-sdk-provider'
 *
 * export const qualityRuntime = {
 *   generate,
 *   model: openrouter('openai/gpt-5'),
 * }
 * ```
 */
export type GenerateFn = (prompt: never, opts: never) => Promise<unknown>

// ─────────────────────────────────────────────────────────────────
// Target
// ─────────────────────────────────────────────────────────────────

/**
 * Internal storage key for a target's runtime definition (the wrapped
 * primitive, defaults, custom run function). Read by the execution engine;
 * never part of the public contract.
 *
 * @internal
 */
export const TARGET_INTERNAL: unique symbol = Symbol('crux.quality.target')

/**
 * Runtime definition carried by every target. @internal
 */
export interface TargetInternal {
  /** The wrapped Crux primitive (prompt/flow/agent/retriever), when any. */
  readonly primitive?: unknown
  /** Execution defaults captured at construction ("variant zero" floor). */
  readonly defaults?: object
  /** Retriever targets: maps case input to the query string. */
  readonly query?: (input: never) => string
  /** Retriever targets: retrieve options. */
  readonly options?: RetrieveOptions
  /** Custom targets: the user-provided run function. */
  readonly run?: (input: never, params: never) => unknown
}

/**
 * The erased base every target shares — used for runtime discrimination and
 * as the `TaskLike` union member. Prefer the generic {@link Target} in
 * signatures.
 */
export interface AnyTarget {
  /** Discriminant tag for runtime task lifting. */
  readonly _tag: 'QualityTarget'
  /** The wrapped task kind. */
  readonly kind: 'prompt' | 'flow' | 'agent' | 'retriever' | 'fn'
  /** Optional stable id (defaults to the primitive's own id/name). */
  readonly id?: string
  /** The trace signal families this target captures. */
  readonly capabilities: readonly Capability[]
  /** @internal Runner-only execution definition; not part of the public API. */
  readonly [TARGET_INTERNAL]: TargetInternal
}

/**
 * A parameterized, signal-capturing task.
 *
 * `TParams` is the variant-overridable surface — `variants` entries are typed
 * `Partial<TParams>`, so a target built from a prompt accepts `model`,
 * `settings`, `prompt`, and `generate` overrides while a params-ignoring
 * plain function accepts none. `TCaps` gates which `ctx.expect.*` signal
 * namespaces exist at compile time.
 *
 * Users never call a target — only the runner executes it.
 *
 * @typeParam TInput  - Case input type, flowing into `data` and `ctx.input`.
 * @typeParam TOutput - Task output type, flowing into `ctx.output` and scorers.
 * @typeParam TParams - The variant-overridable execution parameter surface.
 * @typeParam TCaps   - Captured capability union gating `ctx.expect`.
 *
 * @example
 * ```ts
 * const t = target.prompt(supportPrompt, { model: 'gpt-5' })
 * // Target<{ question: string }, { answer: string }, PromptParams<…>, 'modelCalls' | 'citations' | 'safety'>
 * ```
 */
export interface Target<in out TInput, out TOutput, in TParams extends object, out TCaps extends Capability>
  extends AnyTarget {
  readonly capabilities: readonly TCaps[]
  /**
   * Inference-only phantom carrying the target's generics. Never present at
   * runtime.
   *
   * @internal
   */
  readonly __cruxQualityTarget?: {
    input: (input: TInput) => TInput
    output: () => TOutput
    params: (params: TParams) => void
    caps: () => TCaps
  }
}

// ─────────────────────────────────────────────────────────────────
// Per-kind parameter surfaces
// ─────────────────────────────────────────────────────────────────

/**
 * Execution parameters for prompt tasks — what `params` and `variants` may
 * override when the task is a prompt (bare or via `target.prompt`).
 *
 * @typeParam P - The task prompt; kept for signature stability and future
 *                compatibility narrowing.
 */
export interface PromptParams<P extends AnyPrompt = AnyPrompt> {
  /**
   * Replacement prompt. Must be input/output-compatible with the task prompt:
   * it must accept the task's case input and produce an assignable output.
   * Compatibility is enforced at compile time where this appears in
   * `variants`, and re-checked at run time during normalization.
   */
  prompt?: AnyPrompt
  /** Model override for this prompt's calls. */
  model?: ModelRef
  /** Generation settings override (temperature, maxTokens, …). */
  settings?: ModelSettings
  /** Adapter generate fn imported or created by the eval. */
  generate?: GenerateFn
}

/**
 * Execution parameters for flow tasks.
 *
 * @typeParam F - The task flow handle; kept for signature stability.
 */
export interface FlowParams<F extends AnyFlowHandle = AnyFlowHandle> {
  /** Default model for every model-backed step. */
  model?: ModelRef
  /** Default generation settings for every model-backed step. */
  settings?: ModelSettings
  /**
   * Per-step model/settings overrides, keyed by step name. Step names are not
   * statically known (flow steps are created imperatively inside the handler),
   * so keys are plain strings; unknown names are a run-time definition error.
   */
  steps?: Record<string, { model?: ModelRef; settings?: ModelSettings }>
  /** Adapter generate fn imported or created by the eval. */
  generate?: GenerateFn
}

/**
 * Scripted tool results for agent evaluation, keyed by tool name.
 *
 * A value is either a static result returned for every invocation, or a
 * function `(args) => result` invoked with the tool-call arguments. Mocked
 * tools still emit `toolCalls` signals, so `expect.toolCalls` assertions see
 * the scripted calls.
 *
 * @example
 * ```ts
 * target.agent(supportAgent, {
 *   tools: {
 *     lookupOrder: { status: 'shipped' },
 *     searchDocs: (args) => [{ id: 'docs/refunds', score: 0.92 }],
 *   },
 * })
 * ```
 */
export type ToolMocks = Record<string, unknown>

/**
 * Execution parameters for agent tasks — the flow surface plus tool mocks and
 * the agent-loop safety bound.
 *
 * @typeParam A - The task agent; kept for signature stability.
 */
export interface AgentParams<A extends AnyAgent = AnyAgent> {
  /** Default model for the agent's calls. */
  model?: ModelRef
  /** Default generation settings. */
  settings?: ModelSettings
  /** Per-step model/settings overrides, keyed by step name. */
  steps?: Record<string, { model?: ModelRef; settings?: ModelSettings }>
  /** Adapter generate fn imported or created by the eval. */
  generate?: GenerateFn
  /** Scripted tool results, keyed by tool name. */
  tools?: ToolMocks
  /** Safety bound on agent loop length. Default 15. */
  maxToolSteps?: number
}

/**
 * Options for `target.retriever()`.
 *
 * @typeParam R      - The wrapped retriever.
 * @typeParam TInput - The case input shape. Defaults to `{ query: string }`.
 */
export interface RetrieverTargetOptions<R extends AnyRetriever = AnyRetriever, TInput = { query: string }> {
  /** Stable target id. Defaults to the retriever's own id. */
  id?: string
  /** Maps case input to the retriever query. Required when `TInput` is not `{ query: string }`. */
  query?: (input: TInput) => string
  /** Retrieve options forwarded to every call (limit, threshold, mode, …). */
  options?: RetrieveOptions
}

// ─────────────────────────────────────────────────────────────────
// TaskLike + inference utilities
// ─────────────────────────────────────────────────────────────────

/** Widest flow-handle type — any `FlowHandle<T, TInput>` is assignable. */
export type AnyFlowHandle = FlowHandle<unknown, never>

/** Widest retriever type (retrievers are not generic). */
export type AnyRetriever = Retriever

/**
 * What `evaluate()` accepts as `task`. Crux primitives are tasks directly —
 * the runner lifts them via their discriminants. Use `target.*` only to set
 * execution defaults or unlock variant parameters.
 *
 * @example
 * ```ts
 * evaluate({ task: supportPrompt, data: cases })          // bare primitive
 * evaluate({ task: target.prompt(supportPrompt), data })  // parameterized
 * evaluate({ task: async (input: { q: string }) => …, data }) // plain fn
 * ```
 */
export type TaskLike =
  | AnyPrompt // _tag: 'Prompt'        → kind 'prompt'
  | AnyAgent // _tag: 'Agent'          → kind 'agent'
  | AnyFlowHandle // flow() handle     → kind 'flow'
  | AnyRetriever // retriever()        → kind 'retriever'
  | AnyTarget // anything built by target.*
  // Plain fn → kind 'fn'. The second parameter is required-`never` so that
  // BOTH `(input) => out` and `(input, params) => out` are assignable
  // (an optional parameter here would reject params-taking fns under
  // strictFunctionTypes).
  | ((input: never, params: never) => unknown)

/** Case input type of a prompt task: zod INPUT of its merged schema. @internal */
export type PromptTaskInput<P> =
  P extends Prompt<infer I extends z.ZodType, infer _O, infer C extends readonly ContextEntry[]>
    ? Simplify<z.input<I> & MergeContextInputs<C>>
    : never

/** Output type of a prompt task: zod OUTPUT, or `string` in text mode. @internal */
export type PromptTaskOutput<P> =
  P extends Prompt<infer _I, infer O, infer _C> ? (O extends z.ZodType ? z.output<O> : string) : never

/** Case input type of an agent task (from its prompt). @internal */
export type AgentTaskInput<A> =
  A extends Agent<infer I extends z.ZodType, infer _O, infer C> ? Simplify<z.input<I> & MergeContextInputs<C>> : never

/** Output type of an agent task (from its prompt). @internal */
export type AgentTaskOutput<A> =
  A extends Agent<infer _I, infer O, infer _C> ? (O extends z.ZodType ? z.output<O> : string) : never

/** Case input type of a flow task. @internal */
export type FlowTaskInput<F> = F extends FlowHandle<infer _T, infer I> ? I : never

/** Output type of a flow task (the completed flow's output). @internal */
export type FlowTaskOutput<F> = F extends FlowHandle<infer T, infer _I> ? T : never

/** Input type of a target via its phantom. @internal */
export type TargetTaskInput<T> = T extends Target<infer I, infer _O, infer _P, infer _C> ? I : never

/** Output type of a target via its phantom. @internal */
export type TargetTaskOutput<T> = T extends Target<infer _I, infer O, infer _P, infer _C> ? O : never

/** Parameter surface of a target via its phantom. @internal */
export type TargetTaskParams<T> = T extends Target<infer _I, infer _O, infer P, infer _C> ? P : never

/** Capability union of a target via its phantom. @internal */
export type TargetTaskCaps<T> = T extends Target<infer _I, infer _O, infer _P, infer C extends Capability> ? C : never

/** Input type of a plain-function task: its first parameter. @internal */
export type FnTaskInput<T> = T extends (input: infer I, ...rest: never[]) => unknown ? I : never

/** Output type of a plain-function task: its awaited return type. @internal */
export type FnTaskOutput<T> = T extends (...args: never[]) => infer R ? Awaited<R> : never

/**
 * Parameter surface of a plain-function task: its second parameter when
 * declared, else `{}` — a params-ignoring task rejects every variant
 * override at compile time. @internal
 */
export type FnTaskParams<T> = T extends (...args: infer A) => unknown
  ? A extends [unknown]
    ? {}
    : A extends [unknown, infer P]
      ? P extends object
        ? P
        : {}
      : A extends [unknown, (infer P)?]
        ? P extends object
          ? P
          : {}
        : {}
  : never

/**
 * The case input type of a task — what `data[].input` must satisfy and what
 * `ctx.input` is typed as. Prompts/agents use the zod INPUT side of their
 * merged schema; flows use their declared input; retrievers default to
 * `{ query: string }`; plain functions use their first parameter.
 *
 * Use this (with {@link CaseOf}) as the one-annotation escape hatch when
 * extracting shared case arrays to another file.
 *
 * @example
 * ```ts
 * type In = InputOf<typeof supportPrompt> // { question: string; locale: 'en' | 'nl' }
 * ```
 */
export type InputOf<T extends TaskLike> = T extends AnyTarget
  ? TargetTaskInput<T>
  : T extends AnyPrompt
    ? PromptTaskInput<T>
    : T extends AnyAgent
      ? AgentTaskInput<T>
      : T extends AnyRetriever
        ? { query: string }
        : T extends AnyFlowHandle
          ? FlowTaskInput<T>
          : T extends (input: infer I, ...rest: never[]) => unknown
            ? I
            : never

/**
 * The output type of a task — what `ctx.output` and scorer `output` are typed
 * as. Structured prompts/agents yield their zod output; text-mode prompts
 * yield `string`; flows yield their handler's return type; retrievers yield
 * `readonly RetrieverHit[]`.
 *
 * @example
 * ```ts
 * type Out = OutputOf<typeof supportPrompt> // { answer: string; confidence: number }
 * ```
 */
export type OutputOf<T extends TaskLike> = T extends AnyTarget
  ? TargetTaskOutput<T>
  : T extends AnyPrompt
    ? PromptTaskOutput<T>
    : T extends AnyAgent
      ? AgentTaskOutput<T>
      : T extends AnyRetriever
        ? readonly RetrieverHit[]
        : T extends AnyFlowHandle
          ? FlowTaskOutput<T>
          : T extends (...args: never[]) => infer R
            ? Awaited<R>
            : never

/**
 * The variant-overridable parameter surface of a task. Variant entries are
 * `Partial<ParamsOf<T>>` — a params-ignoring plain function has `{}` here,
 * which makes every override a compile error (you cannot author a comparison
 * that silently compares nothing).
 *
 * @example
 * ```ts
 * type P = ParamsOf<typeof supportPrompt> // PromptParams: { prompt?, model?, settings?, generate? }
 * ```
 */
export type ParamsOf<T extends TaskLike> = T extends AnyTarget
  ? TargetTaskParams<T>
  : T extends AnyPrompt
    ? PromptParams<T>
    : T extends AnyAgent
      ? AgentParams<T>
      : T extends AnyRetriever
        ? { options?: RetrieveOptions }
        : T extends AnyFlowHandle
          ? FlowParams<T>
          : T extends (...args: never[]) => unknown
            ? FnTaskParams<T>
            : never

/**
 * The capability union of a task — which `ctx.expect.*` signal namespaces
 * exist at compile time. Plain functions capture no signals (`never`).
 *
 * @example
 * ```ts
 * type Caps = CapsOf<typeof supportAgent> // all nine capability families
 * ```
 */
export type CapsOf<T extends TaskLike> = T extends AnyTarget
  ? TargetTaskCaps<T>
  : T extends AnyPrompt
    ? PromptCapability
    : T extends AnyAgent
      ? AgentCapability
      : T extends AnyRetriever
        ? RetrieverCapability
        : T extends AnyFlowHandle
          ? FlowCapability
          : never

/**
 * The expected-value type associated with a task. `expected` is opaque data
 * delivered to scorers and `expect` callbacks — nothing matches it implicitly
 * — so this defaults to `unknown`; the concrete type flows from your cases or
 * dataset schema at the `evaluate()` call.
 */
export type ExpectedOf<T extends TaskLike> = unknown

// ─────────────────────────────────────────────────────────────────
// target constructors (runtime)
// ─────────────────────────────────────────────────────────────────

function createTarget(
  kind: AnyTarget['kind'],
  id: string | undefined,
  capabilities: readonly Capability[],
  internal: TargetInternal,
): AnyTarget {
  return Object.freeze({
    _tag: 'QualityTarget' as const,
    kind,
    ...(id !== undefined ? { id } : {}),
    capabilities,
    [TARGET_INTERNAL]: Object.freeze(internal),
  })
}

/** Custom-target specification accepted by the callable `target()` form. */
export interface CustomTargetSpec<I, O, P extends object> {
  /** Stable id shown in reports and used for cassette keys. */
  id?: string
  /** The task body. `params` receives the merged variant parameters. */
  run: (input: I, params: P) => O | Promise<O>
}

/**
 * The `target` namespace: wrap a Crux primitive (or a custom run function)
 * into a parameterized, signal-capturing task.
 */
export interface TargetConstructor {
  /**
   * Custom task with an id and/or typed params. Plain fns can also be passed
   * to `task:` directly; use this form to name the task or accept params.
   *
   * @example
   * ```ts
   * const t = target({
   *   id: 'pipeline.harness',
   *   run: (input: { q: string }, params: { topK: number }) => search(input.q, params.topK),
   * })
   * ```
   */
  <I extends Record<string, unknown>, O, P extends object = {}>(
    spec: CustomTargetSpec<I, O, P>,
  ): Target<I, O, P, never>

  /**
   * Wrap a prompt with execution defaults. The result captures
   * `modelCalls`/`citations`/`safety` and exposes {@link PromptParams} to
   * variants.
   *
   * @example
   * ```ts
   * evaluate({
   *   task: target.prompt(supportPrompt, { model: 'gpt-5' }),
   *   data: cases,
   *   variants: { cheap: { model: 'gpt-5-mini' } },
   * })
   * ```
   */
  prompt<P extends AnyPrompt>(
    p: P,
    defaults?: PromptParams<P>,
  ): Target<PromptTaskInput<P>, PromptTaskOutput<P>, PromptParams<P>, PromptCapability>

  /**
   * Wrap a flow with execution defaults (whole-flow or per-step model
   * configuration).
   *
   * @example
   * ```ts
   * target.flow(researchFlow, { steps: { plan: { model: 'gpt-5-mini' } } })
   * ```
   */
  flow<F extends AnyFlowHandle>(
    f: F,
    defaults?: FlowParams<F>,
  ): Target<FlowTaskInput<F>, FlowTaskOutput<F>, FlowParams<F>, FlowCapability>

  /**
   * Wrap an agent with execution defaults — tool mocks, loop bounds, models.
   *
   * @example
   * ```ts
   * target.agent(supportAgent, {
   *   tools: { lookupOrder: { status: 'shipped' } },
   *   maxToolSteps: 8,
   * })
   * ```
   */
  agent<A extends AnyAgent>(
    a: A,
    defaults?: AgentParams<A>,
  ): Target<AgentTaskInput<A>, AgentTaskOutput<A>, AgentParams<A>, AgentCapability>

  /**
   * Wrap a retriever. Case input defaults to `{ query: string }`; pass a
   * `query` mapper for any other input shape.
   *
   * @example
   * ```ts
   * target.retriever(docsRetriever, {
   *   query: (input: { question: string }) => input.question,
   *   options: { limit: 8 },
   * })
   * ```
   */
  retriever<R extends AnyRetriever, TInput = { query: string }>(
    r: R,
    opts?: RetrieverTargetOptions<R, TInput>,
  ): Target<TInput, readonly RetrieverHit[], { options?: RetrieveOptions }, RetrieverCapability>
}

function customTarget(spec: CustomTargetSpec<Record<string, unknown>, unknown, object>): AnyTarget {
  if (typeof spec.run !== 'function') {
    throw new TypeError('target(): `run` must be a function.')
  }
  return createTarget('fn', spec.id, Object.freeze([]), { run: spec.run as TargetInternal['run'] })
}

function promptTarget(p: AnyPrompt, defaults?: object): AnyTarget {
  if (p?._tag !== 'Prompt') throw new TypeError('target.prompt(): expected a Crux prompt.')
  return createTarget('prompt', p.id, PROMPT_CAPABILITIES, { primitive: p, defaults })
}

function flowTarget(f: AnyFlowHandle, defaults?: object): AnyTarget {
  if (typeof f?.run !== 'function' || typeof f.name !== 'string') {
    throw new TypeError('target.flow(): expected a Crux flow handle.')
  }
  return createTarget('flow', f.name, FLOW_CAPABILITIES, { primitive: f, defaults })
}

function agentTarget(a: AnyAgent, defaults?: object): AnyTarget {
  if (a?._tag !== 'Agent') throw new TypeError('target.agent(): expected a Crux agent.')
  return createTarget('agent', a.id, AGENT_CAPABILITIES, { primitive: a, defaults })
}

function retrieverTarget(r: AnyRetriever, opts?: RetrieverTargetOptions<AnyRetriever, never>): AnyTarget {
  if (r?._tag !== 'Retriever' && r?._tag !== 'RetrievalPipeline') {
    throw new TypeError('target.retriever(): expected a Crux retriever.')
  }
  return createTarget('retriever', opts?.id ?? r.id, RETRIEVER_CAPABILITIES, {
    primitive: r,
    query: opts?.query,
    options: opts?.options,
  })
}

/**
 * Build a parameterized, signal-capturing task from a Crux primitive or a
 * custom run function.
 *
 * A bare primitive passed to `evaluate({ task })` is equivalent to wrapping
 * it here with no defaults — reach for `target.*` when you need execution
 * defaults (model, settings, tool mocks) or typed variant parameters.
 *
 * @example
 * ```ts
 * import { evaluate, target } from '@use-crux/core/quality'
 *
 * evaluate({
 *   task: target.prompt(supportPrompt, { model: 'gpt-5' }),
 *   data: cases,
 *   variants: { candidate: { prompt: candidatePrompt } },
 * })
 * ```
 */
export const target: TargetConstructor = Object.assign(customTarget, {
  prompt: promptTarget,
  flow: flowTarget,
  agent: agentTarget,
  retriever: retrieverTarget,
}) as unknown as TargetConstructor
