/** Frozen, typed Agent definitions for provider-neutral composition. @module */

import type { z } from "zod";
import type { AnyModel, AnyToolSet } from "../types";
import type { Prompt } from "../prompt/prompt-types";
import type { ContextEntry } from "../prompt/context-types";
import type { AnyRoutable } from "../routing/types";
import type { InputBudget } from "../request/budget/input-budget";
import { mergeInputBudget } from "../request/budget/input-budget";
import type { PrepareStep } from "../request/prepare/step";

// ── Types ───────────────────────────────────────────────────────────

/**
 * Model reference accepted by `agent({ model })`.
 *
 * `TModel` is the adapter-native model type (for example an AI SDK language
 * model or a native provider model id). Routing wrappers are inert core values
 * that loop-owned adapters resolve before the provider sees a concrete model.
 */
export type RoutableModel<TModel = AnyModel> = TModel | AnyRoutable;

interface AgentConfigBase<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TModel extends RoutableModel | undefined = undefined,
> {
  /** Unique identifier for this agent. */
  id: string;
  /** Human-readable description of what this agent does. */
  description?: string;
  /** The prompt this agent executes. */
  prompt: Prompt<TOwnInput, TOutput, TContexts>;
  /**
   * Default tools available to this agent. Named maps may contain ordinary
   * Tools or direct child Agents, with each key used as the provider tool name.
   * A child Agent runs as an awaited foreground Tool through ordinary Tool
   * policy, using its Agent/Prompt description and Prompt input/output
   * contracts. It inherits cancellation and ancestry, but not parent authority.
   */
  tools?: AnyToolSet;
  /** Default whole-request input pressure settings for each provider call. */
  inputBudget?: InputBudget;
  /** Default callback evaluated before every semantic provider call. */
  prepareStep?: PrepareStep<TModel>;
  /**
   * Agent IDs this agent can hand off to in a swarm.
   *
   * Declares routing targets for `swarm()`. Each entry is either a
   * plain string (agent ID) or an object with `id` and `when` (a condition
   * string injected into the transfer tool's description to guide the LLM).
   *
   * Validated at runtime by `swarm()`, not at definition time.
   *
   * @example
   * ```ts
   * const triage = agent({
   *   id: 'triage',
   *   prompt: triagePrompt,
   *   handoffs: [
   *     'general',
   *     { id: 'billing', when: 'Customer has a billing or payment issue' },
   *     { id: 'refunds', when: 'Customer explicitly requests a refund' },
   *   ],
   * })
   * ```
   */
  handoffs?: Array<string | { id: string; when: string }>;
  /**
   * Tool names available in swarm context.
   *
   * When set, only these tools (by name) are passed to the executor
   * during `swarm()`. Transfer tools are always included regardless.
   * Without this, all agent tools are available.
   *
   * Can be overridden at the swarm level via `SwarmOptions.activeTools`.
   */
  swarmTools?: string[];
}

type AgentModelConfig<TModel> =
  | { model: TModel }
  | ([TModel] extends [undefined] ? { model?: undefined } : never);

/** Configuration for `agent()`. */
export type AgentConfig<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TModel extends RoutableModel | undefined = undefined,
> = AgentConfigBase<TOwnInput, TOutput, TContexts, TModel> &
  AgentModelConfig<TModel>;

/** A single handoff target entry (normalized from string or object form). */
export interface HandoffTarget {
  /** Target agent ID. */
  readonly id: string;
  /** Condition string injected into the transfer tool's description. */
  readonly when?: string;
}

/** A frozen agent instance. Pure data — no execution logic. */
export interface Agent<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  TModel extends RoutableModel | undefined = undefined,
> {
  /** Discriminant tag for runtime type checking. */
  readonly _tag: "Agent";
  /** Unique identifier. */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string | undefined;
  /** The prompt this agent executes. */
  readonly prompt: Prompt<TOwnInput, TOutput, TContexts>;
  /** Default model override. */
  readonly model: TModel;
  /**
   * Default tools. Named maps may contain ordinary Tools or direct child
   * Agents; keys are provider tool names. Child Agents are awaited foreground
   * Tools that use their Agent/Prompt description and Prompt input/output
   * contracts, traverse ordinary Tool policy, and inherit cancellation and
   * ancestry but no parent authority.
   */
  readonly tools: AnyToolSet | undefined;
  /** Default whole-request input pressure settings. */
  readonly inputBudget: InputBudget | undefined;
  /** Default callback evaluated before every semantic provider call. */
  readonly prepareStep: PrepareStep<TModel> | undefined;
  /** Agent IDs this agent can hand off to in a swarm. */
  readonly handoffs: readonly HandoffTarget[];
  /** Tool names available in swarm context. */
  readonly swarmTools: readonly string[] | undefined;
}

/**
 * Base agent type for heterogeneous collections (e.g., swarm agent maps).
 *
 * Uses `z.ZodType` as upper bounds — the widest Zod schema types — so
 * any `Agent<TInput, TOutput, TContexts>` is assignable to `AnyAgent`.
 */
export type AnyAgent = Agent<
  z.ZodType,
  z.ZodType | undefined,
  readonly ContextEntry[],
  RoutableModel | undefined
>;

/**
 * Extract the inferred input type from an agent's prompt schema.
 *
 * @example
 * ```ts
 * const agent = agent({ id: 'x', prompt: prompt({ input: z.object({ query: z.string() }), ... }) })
 * type Input = InferAgentInput<typeof agent>  // { query: string }
 * ```
 */
export type InferAgentInput<T> =
  T extends Agent<
    infer TInput,
    z.ZodType | undefined,
    readonly ContextEntry[],
    RoutableModel | undefined
  >
    ? TInput extends z.ZodType
      ? z.infer<TInput>
      : unknown
    : unknown;

/**
 * Extract the inferred output type from an agent's prompt schema.
 * Returns `string` for text-mode agents (no output schema).
 *
 * @example
 * ```ts
 * const agent = agent({ id: 'x', prompt: prompt({ output: z.object({ draft: z.string() }), ... }) })
 * type Output = InferAgentOutput<typeof agent>  // { draft: string }
 * ```
 */
export type InferAgentOutput<T> =
  T extends Agent<
    z.ZodType,
    infer TOutput,
    readonly ContextEntry[],
    RoutableModel | undefined
  >
    ? TOutput extends z.ZodType
      ? z.infer<TOutput>
      : string
    : unknown;

/**
 * Escape hatch type: accepts either an `Agent` instance or a plain async
 * function for use in composition utilities.
 *
 * The plain-function variant uses `never` in parameter position so the
 * union is bivariant — functions accepting specific input shapes
 * (`(input: { foo: string }) => …`) still satisfy `AgentLike`, while the
 * composition utilities infer the real shape from the call-site generic.
 */
export type AgentLike<TInput = never, TOutput = unknown> =
  | AnyAgent
  | ((input: TInput) => Promise<TOutput>);

/**
 * Extract the input type from an `AgentLike` — agent (via its prompt schema)
 * or plain async function (via its parameter type).
 */
export type InferAgentLikeInput<T> = T extends AnyAgent
  ? InferAgentInput<T>
  : T extends (input: infer I) => Promise<unknown>
    ? I
    : Record<string, unknown>;

/**
 * Extract the output type from an `AgentLike` — agent (via its prompt output
 * schema, defaulting to `string` for text-mode) or plain async function
 * (via its return type).
 */
export type InferAgentLikeOutput<T> = T extends AnyAgent
  ? InferAgentOutput<T>
  : T extends (input: never) => Promise<infer O>
    ? O
    : unknown;

// ── Type Guard ──────────────────────────────────────────────────────

/**
 * Check whether a value is an `Agent` instance created by `agent()`.
 *
 * @param value - The value to check.
 * @returns `true` if the value is an `Agent`, `false` otherwise.
 *
 * @example
 * ```ts
 * if (isAgent(entry)) {
 *   // entry is Agent — use executor
 * } else {
 *   // entry is a plain function — call directly
 * }
 * ```
 */
export function isAgent(value: unknown): value is AnyAgent {
  return (
    typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { _tag: unknown })._tag === "Agent"
  );
}

// ── Factory ─────────────────────────────────────────────────────────

/** Define a frozen Agent while retaining its exact model type. */
export function agent<
  TOwnInput extends z.ZodType,
  TOutput extends z.ZodType | undefined,
  TContexts extends readonly ContextEntry[],
  const TModel extends RoutableModel | undefined = undefined,
>(
  config: AgentConfig<TOwnInput, TOutput, TContexts, TModel>,
): Agent<TOwnInput, TOutput, TContexts, TModel> {
  return Object.freeze({
    _tag: "Agent" as const,
    id: config.id,
    description: config.description,
    prompt: config.prompt,
    // The config union permits absence only for the undefined model.
    model: config.model as TModel,
    tools: config.tools,
    inputBudget: mergeInputBudget(undefined, config.inputBudget),
    prepareStep: config.prepareStep,
    handoffs: Object.freeze(
      (config.handoffs ?? []).map(
        (h): HandoffTarget =>
          typeof h === "string" ? { id: h } : { id: h.id, when: h.when },
      ),
    ),
    swarmTools: config.swarmTools
      ? Object.freeze([...config.swarmTools])
      : undefined,
  });
}
