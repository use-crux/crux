/**
 * Public, SDK-agnostic types for the `tools/` domain.
 *
 * Two related surfaces live here:
 *
 * - **Tool authoring** — the {@link ToolConfig} / {@link NamedToolDef} shapes
 *   used by {@link "./define-tool".tool | tool()}.
 * - **Tool middleware & approval** — the contracts used by
 *   {@link "./middleware".toolMiddleware | toolMiddleware()},
 *   {@link "./middleware".approvalMiddleware | approvalMiddleware()}, and the
 *   resumable approval protocol helpers in `./approvals`.
 *
 * These are kept provider-agnostic so adapter packages can mirror them without
 * importing a specific SDK.
 *
 * @module
 */

import type { z } from 'zod'
import type { JsonValue, ToolDef, ToolModelOutput, ToModelOutputArgs } from '../types/tool'

// ─────────────────────────────────────────────────────────────────
// Tool authoring
// ─────────────────────────────────────────────────────────────────

/**
 * Declarative configuration accepted by {@link "./define-tool".tool | tool()}.
 *
 * @typeParam TInputSchema - Zod schema describing the tool input.
 * @typeParam TOutput - Resolved output type returned by `execute`.
 * @typeParam TName - Optional literal tool name preserved through inference.
 */
export interface ToolConfig<
  TInputSchema extends z.ZodType,
  TOutput,
  TName extends string | undefined = string | undefined,
> {
  /**
   * Optional stable name used by adapters that need named registries.
   * Prompt-level tool objects still use their object key as the canonical name.
   */
  name?: TName
  description: string
  input?: TInputSchema
  parameters?: TInputSchema
  execute: (input: z.infer<TInputSchema>) => TOutput | Promise<TOutput>
  toModelOutput?: (
    args: ToModelOutputArgs<z.infer<TInputSchema>, TOutput>,
  ) => ToolModelOutput | Promise<ToolModelOutput>
}

/**
 * A {@link ToolDef} that also carries an optional literal `name`, preserved so
 * adapters can build named tool registries from authored tools.
 */
export type NamedToolDef<TInput, TOutput, TName extends string | undefined = string | undefined> = ToolDef<
  TInput,
  TOutput
> & {
  readonly name?: TName
}

// ─────────────────────────────────────────────────────────────────
// Approval message parts
// ─────────────────────────────────────────────────────────────────

/** Terminal state of a human-in-the-loop tool approval. */
export type ToolApprovalStatus = 'approved' | 'denied'

/** Human-facing payload describing what is being approved. */
export interface ToolApprovalRequestPayload {
  readonly title?: string
  readonly description?: string
  readonly details?: JsonValue
}

/** Message part emitted when a tool call is suspended pending approval. */
export interface ToolApprovalRequestPart {
  readonly type: 'tool-approval-request'
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: JsonValue
  readonly request?: ToolApprovalRequestPayload
  readonly approvalToken?: string
}

/** Message part carrying a user's decision on a pending approval. */
export interface ToolApprovalResponsePart {
  readonly type: 'tool-approval-response'
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}

/** Normalized approval request, resolved from message history. */
export interface ToolApprovalRequest {
  readonly approvalId: string
  readonly toolCallId: string
  readonly toolName: string
  readonly input: unknown
  readonly request?: ToolApprovalRequestPayload
  readonly approvalToken?: string
}

/** Normalized approval decision, resolved from message history. */
export interface ToolApprovalDecision {
  readonly approvalId: string
  readonly approved: boolean
  readonly reason?: string
  readonly approvalToken?: string
}

// ─────────────────────────────────────────────────────────────────
// Tool call context
// ─────────────────────────────────────────────────────────────────

/** Context describing a single tool invocation, passed to middleware hooks. */
export interface ToolCallContext<TInput = unknown> {
  readonly toolName: string
  readonly toolCallId: string
  readonly input: TInput
  readonly options: ToolExecutionOptions
  readonly messages?: readonly unknown[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** {@link ToolCallContext} extended with the produced output. */
export interface ToolResultContext<TInput = unknown, TOutput = unknown> extends ToolCallContext<TInput> {
  readonly output: TOutput
  readonly durationMs: number
}

/** {@link ToolCallContext} extended with the thrown error. */
export interface ToolErrorContext<TInput = unknown> extends ToolCallContext<TInput> {
  readonly error: unknown
  readonly durationMs: number
}

/**
 * A predicate that selects which tools a middleware applies to.
 *
 * - `string` — exact tool-name match.
 * - `RegExp` — tool-name pattern match.
 * - function — arbitrary (optionally async) predicate over the call context.
 */
export type ToolMatcher<TInput = unknown> =
  | string
  | RegExp
  | ((call: ToolCallContext<TInput>) => boolean | PromiseLike<boolean>)

/** Continuation passed to {@link ToolMiddlewareConfig.aroundExecute}. */
export type ToolMiddlewareNext<TInput, TOutput> = (
  input: TInput,
  options: ToolExecutionOptions,
) => TOutput | PromiseLike<TOutput>

/** Loosely-typed per-call options threaded through tool execution. */
export interface ToolExecutionOptions {
  readonly toolCallId?: string
  readonly messages?: readonly unknown[]
  readonly [key: string]: unknown
}

/** The shape of a tool's `execute` function. */
export type ToolExecuteFunction<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  options: ToolExecutionOptions,
) => TOutput | PromiseLike<TOutput>

/**
 * Structural contract for any tool object a middleware can wrap.
 *
 * Kept intentionally loose (index signature) so middleware composes over
 * tools authored by any SDK, not just Crux's {@link NamedToolDef}.
 */
export interface ToolLike<TInput = unknown, TOutput = unknown> {
  readonly description?: string
  readonly title?: string
  readonly execute?: ToolExecuteFunction<TInput, TOutput>
  readonly needsApproval?:
    | boolean
    | ((input: TInput, options: ToolExecutionOptions) => boolean | PromiseLike<boolean>)
  readonly toModelOutput?: (args: {
    readonly toolCallId: string
    readonly input: TInput
    readonly output: TOutput
  }) => ToolModelOutput | PromiseLike<ToolModelOutput>
  readonly [key: string]: unknown
}

// ─────────────────────────────────────────────────────────────────
// Middleware contracts
// ─────────────────────────────────────────────────────────────────

/** A tagged middleware that can wrap a tool to add cross-cutting behavior. */
export interface ToolMiddleware {
  readonly _tag: 'ToolMiddleware'
  readonly id: string
  wrapTool<TInput, TOutput>(
    toolName: string,
    tool: ToolLike<TInput, TOutput>,
  ): ToolLike<TInput, TOutput>
}

/** Configuration for {@link "./middleware".toolMiddleware | toolMiddleware()}. */
export interface ToolMiddlewareConfig {
  readonly id: string
  readonly match?: readonly ToolMatcher[]
  readonly beforeExecute?: (call: ToolCallContext) => void | PromiseLike<void>
  readonly aroundExecute?: (
    call: ToolCallContext,
    next: ToolMiddlewareNext<unknown, unknown>,
  ) => unknown | PromiseLike<unknown>
  readonly afterExecute?: (result: ToolResultContext) => void | PromiseLike<void>
  readonly onError?: (error: ToolErrorContext) => void | PromiseLike<void>
}

/** Configuration for {@link "./middleware".approvalMiddleware | approvalMiddleware()}. */
export interface ApprovalMiddlewareConfig<TInput = unknown> {
  readonly id: string
  readonly match: readonly ToolMatcher<TInput>[]
  readonly onRequest?: (call: ToolCallContext<TInput>) => void | PromiseLike<void>
  readonly onApproved?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
  readonly onDenied?: (event: ToolApprovalDecisionEvent<TInput>) => void | PromiseLike<void>
}

/** {@link ToolCallContext} extended with a resolved approval outcome. */
export interface ToolApprovalDecisionEvent<TInput = unknown> extends ToolCallContext<TInput> {
  readonly approvalId: string
  readonly status: ToolApprovalStatus
  readonly reason?: string
}

export type { ToolDef, ToolModelOutput, ToModelOutputArgs } from '../types/tool'
