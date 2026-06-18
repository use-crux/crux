import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { z } from 'zod'
import type { ConvexRuntimeTarget } from '../runtime'

/** Metadata supplied by Convex Agent for one tool invocation. */
export interface ConvexAgentToolOptions {
  /** Stable provider/tool-call id for the current tool invocation. */
  readonly toolCallId?: string
}

/** Definition used by the lifecycle when adapting a Crux tool for Convex Agent. */
export interface ConvexAgentToolDefinition {
  /** Human-readable tool name, usually the object key from the resolved prompt. */
  readonly name: string
  /** Tool description forwarded to Convex Agent. */
  readonly description?: string
  /** Zod input schema expected by Convex Agent's `createTool()`. */
  readonly inputSchema: z.ZodType
  /** Execute the adapted tool with Convex Agent's runtime metadata. */
  execute(toolCtx: unknown, args: Record<string, unknown>, options?: ConvexAgentToolOptions): Promise<unknown> | unknown
}

/** Convex-Agent-shaped options that Crux forwards without interpreting. */
export type ConvexAgentPassthroughOptions = Record<string, unknown>

/** Definition passed to the Convex Agent driver when a turn needs a session. */
export interface ConvexAgentDriverDefinition {
  /** Convex Agent component ref. */
  readonly component: unknown
  /** Public agent name. */
  readonly name: string
  /** Model object forwarded as Convex Agent's `languageModel`. */
  readonly languageModel: LanguageModelV3
  /** Resolved system instructions. */
  readonly instructions: string
  /** Resolved and adapted tool map. */
  readonly tools: Record<string, unknown>
  /** Additional Convex Agent constructor options from the public facade. */
  readonly options: ConvexAgentPassthroughOptions
}

/** Minimal thread surface the lifecycle needs from Convex Agent. */
export interface ConvexAgentThreadSession {
  readonly threadId: string
  getMetadata(): Promise<unknown>
  updateMetadata(patch: Record<string, unknown>): Promise<unknown>
}

/** Convex-Agent-shaped session created by the driver. */
export interface ConvexAgentSession {
  generateText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  streamText(
    ctx: unknown,
    target: ConvexRuntimeTarget,
    args: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>
  continueThread(
    ctx: unknown,
    target: { threadId: string; userId?: string | null },
  ): Promise<{ thread: ConvexAgentThreadSession }>
}

/** Request used to inspect Convex Agent thread context before a continued turn. */
export interface ConvexAgentContextRequest {
  readonly ctx: unknown
  readonly component: unknown
  readonly agentName: string
  readonly agentOptions: ConvexAgentPassthroughOptions
  readonly target: ConvexRuntimeTarget & { threadId: string }
  readonly callArgs: Record<string, unknown>
  readonly options?: Record<string, unknown>
}

/** Message lists captured from Convex Agent's thread context machinery. */
export interface ConvexAgentContextSnapshot {
  readonly all: readonly ConvexAgentContextMessage[]
  readonly search: readonly ConvexAgentContextMessage[]
  readonly recent: readonly ConvexAgentContextMessage[]
  readonly inputMessages: readonly ConvexAgentContextMessage[]
  readonly inputPrompt: readonly ConvexAgentContextMessage[]
  readonly existingResponses: readonly ConvexAgentContextMessage[]
  readonly threadId?: string
  readonly userId?: string
}

/** Message shape passed to user `prepare()` callbacks. */
export interface ConvexAgentContextMessage {
  readonly role: string
  readonly content?: unknown
}

/**
 * Internal adapter port for `@convex-dev/agent`.
 *
 * The profile-backed lifecycle depends on this shape instead of importing the
 * Convex Agent SDK directly, so boundary tests can fake the external runtime
 * while still exercising real Crux prompt, context, memory, and tool plumbing.
 */
export interface ConvexAgentDriver {
  /** Create a Convex-Agent-shaped session for one prepared turn. */
  create(definition: ConvexAgentDriverDefinition): ConvexAgentSession
  /** Inspect persisted thread context before resolving a continued Crux turn. */
  fetchContext(request: ConvexAgentContextRequest): Promise<ConvexAgentContextSnapshot>
  /** Convert a Crux tool definition into a Convex Agent tool object. */
  createTool(definition: ConvexAgentToolDefinition): unknown
  /** Wrap an already-authored Convex Agent tool with Crux runtime behavior. */
  wrapTool<TTool>(tool: TTool, options: { name?: string }): TTool
}
