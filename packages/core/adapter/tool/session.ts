/**
 * The per-call `ToolLifecycle` session — the single consumption entry point
 * for everything between "the model emitted tool calls" and "tool results
 * are ready for the next round".
 *
 * Authoring stays with `tool()`, `toolMiddleware()`, and
 * `approvalMiddleware()`. Execution goes through one session per
 * `generate()`/`stream()` call, created with {@link createToolLifecycle}.
 * The session owns everything the adapter dialects used to coordinate by
 * hand:
 *
 * - Tool merge precedence (call tools shadow prompt tools) and middleware
 *   chain order (prompt middleware before call middleware).
 * - The full approval protocol: deterministic `approval_<toolCallId>` ids,
 *   crypto token minting, token verification, the approval-request message
 *   shape, decision discovery, and idempotent resume replay.
 * - The per-call gate → execute → settle state machine that both
 *   inversion-of-control regimes drive.
 * - Instrumentation emission for both regime profiles (spans, artifacts,
 *   `onToolStart`/`onToolEnd` hook payloads), preserved from the
 *   pre-session dialects.
 * - Output normalization (`toModelOutput`, default shaping, rendering) —
 *   identical in live, resumed, and denied paths.
 * - The `LoadSkill` side effect: detection, re-resolution via the injected
 *   closure, system-prompt augmentation, tool re-arm, step refund.
 * - Post-generation memory capture with at-most-once semantics.
 *
 * Adapter dialects must contain zero tool policy: construct a session,
 * `resume()` before the first provider call, drive rounds (pull regime) or
 * hand over the armed `tools` map (push regime), `applySkillLoads()` per
 * step, `suspend()` on SDK suspension, and `captureTurn()` at the end.
 *
 * @module
 */

import { z } from 'zod'
import type { ResolvedPrompt } from '../../types'
import type { Message } from '../../generation/messages'
import type { JsonValue, ToolModelOutput } from '../../types/tool'
import type { SystemBlock } from '../../types'
import type { AdapterResponse, CallArgs, ToolResultEntry } from '../types'
import { applyToolMiddleware, notifyToolApprovalResponses } from '../../tools/middleware'
import { findToolApprovalRequests, findToolApprovalDecision, deniedToolModelOutput } from '../../tools/approvals'
import type { ToolMiddleware } from '../../tools/types'
import { getRuntime } from '../../runtime/runtime'
import { getExecutionContext } from '../../runtime/execution-context'
import { observe } from '../../observability'
import {
  instrumentToolSet,
  createToolModelOutput,
  renderToolModelOutput,
  measureModelOutput,
  measureUnknown,
  normalizeToolInput,
  toJsonValue,
  openToolCallSpan,
  emitToolArgsArtifact,
  emitToolResultArtifact,
  emitToolRequestArtifacts,
} from './emission'
import { captureMemoryTurn, readSkillActivationSession } from './resolved'
import type { SkillActivationSession } from '../../skill/session'
import { LOAD_SKILL_TOOL_NAME } from '../../skill/tools'
import {
  createApprovalId,
  createApprovalToken as defaultCreateApprovalToken,
  createApprovalRequestMessage,
  createSyntheticToolCallResponse,
  findValidApprovalDecision,
  findApprovedOrDeniedToolCalls,
  emitToolApprovalObservation,
} from './approval'
import type { ApprovalRequestInfo } from './approval'

// ─────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────

/** One canonical, schema-sanitized tool descriptor for a provider call. */
export type ToolDescriptor = NonNullable<CallArgs['tools']>[number]

/** How to append a tool round (assistant tool calls + results) to history. */
export type AppendToolRound = (
  messages: Message[],
  assistantResponse: AdapterResponse,
  toolResults: ToolResultEntry[],
) => Message[]

/** Options for {@link createToolLifecycle} — one session per generate/stream call. */
export interface ToolLifecycleOptions {
  /**
   * Which inversion-of-control regime drives the gates.
   *
   * - `'core'` — the dialect extracts tool calls from the provider response
   *   and hands them to `executeRound()`; the session executes them.
   * - `'sdk'` — the underlying SDK runs the tool loop and calls the armed
   *   execute functions; the session never runs a loop of its own
   *   (`executeRound()` throws in this regime — RFC #28 SDK delegation).
   *
   * Also selects the instrumentation emission profile, preserved from the
   * pre-session dialects (resume replays use the full core profile in both
   * regimes).
   */
  readonly regime: 'core' | 'sdk'
  /** The resolved prompt — tools, toolMiddleware, `_skillSession`, and memory bindings are read internally. */
  readonly resolved: ResolvedPrompt
  /** Per-call additions (highest precedence), straight from generate/stream opts. */
  readonly call?: {
    readonly tools?: Record<string, unknown>
    readonly toolMiddleware?: ToolMiddleware | readonly ToolMiddleware[]
  }
  /** Identity threaded into spans, hooks, and memory capture. */
  readonly promptId: string | undefined
  readonly input?: Record<string, unknown>
  /**
   * Dialect-owned re-resolution closure: how to resolve the prompt again
   * after `LoadSkill` activates a skill. The session owns everything else
   * about the skill round. When omitted, `applySkillLoads()` is inert.
   */
  readonly reresolve?: (skillSession: SkillActivationSession) => Promise<ResolvedPrompt>
  /**
   * Provider message-shape for a tool round (from `AdapterSpec`). Core
   * regime; the sdk regime always uses the canonical default.
   */
  readonly appendToolRound?: AppendToolRound
  /** Provider-specific JSON Schema sanitization (from `AdapterSpec`). Core regime. */
  readonly sanitizeToolSchema?: (schema: Record<string, unknown>) => Record<string, unknown>
  /** Determinism seam for golden transcript tests. @defaultValue `Date.now` */
  readonly now?: () => number
  /** Determinism seam for golden transcript tests. @defaultValue crypto random */
  readonly createApprovalToken?: () => string
}

/** Outcome of {@link ToolLifecycle.resume}. */
export interface ToolResumeOutcome {
  /** History with the synthetic tool round appended (unchanged when nothing replayed). */
  readonly messages: Message[]
  /** How many decided calls were replayed through the gates. */
  readonly replayed: number
}

/** Outcome of {@link ToolLifecycle.executeRound}. */
export type ToolRoundOutcome =
  | {
      readonly kind: 'completed'
      readonly results: readonly ToolResultEntry[]
      /** History with the tool round appended via the appendToolRound strategy. */
      readonly messages: Message[]
    }
  | {
      readonly kind: 'suspended'
      /** First call that required approval. */
      readonly request: ApprovalRequestInfo
      /** Siblings settled before suspension — already executed, side effects included. */
      readonly settled: readonly ToolResultEntry[]
      /**
       * History with the approval-request message appended, followed by one
       * tool message per settled sibling (their side effects happened — the
       * model must hear about them, and their presence keeps `resume()`
       * from replaying them). Persist as-is.
       */
      readonly messages: Message[]
    }

/** A skill amendment reported by {@link ToolLifecycle.applySkillLoads}. */
export interface SkillAmendment {
  /** The re-resolved system prompt with loaded skill instructions appended. */
  readonly system: string | undefined
  /** The re-resolved system blocks. */
  readonly systemBlocks: readonly SystemBlock[] | undefined
  /** Always `true` — `LoadSkill` never consumes loop budget. */
  readonly refundStep: true
}

/** A sealed SDK suspension from {@link ToolLifecycle.suspend}. */
export interface SuspendedRound {
  /** History ending in the approval-request message(s) — persist as-is. */
  readonly messages: Message[]
  /** The minted approval requests, one per pending call. */
  readonly requests: readonly ApprovalRequestInfo[]
}

/**
 * Machine-readable protocol trace for the dialect parity suite: both
 * dialects must produce identical event sequences for the same inputs.
 * (`round` events are core-regime only — the SDK owns round boundaries in
 * the push regime, so `executeRound()` is what emits them.)
 */
export type ToolProtocolEvent =
  | { readonly t: 'prepare'; readonly tools: number; readonly middleware: number }
  | { readonly t: 'decision.notify'; readonly decisions: number }
  | { readonly t: 'resume'; readonly replayed: number }
  | {
      readonly t: 'gate'
      readonly toolCallId: string
      readonly toolName: string
      readonly verdict: 'execute' | 'denied' | 'suspend' | 'not-found'
      readonly origin: 'live' | 'replay'
    }
  | { readonly t: 'execute.settle'; readonly toolCallId: string; readonly outcome: 'ok' | 'error' }
  | { readonly t: 'suspend.mint'; readonly toolCallId: string; readonly approvalId: string }
  | { readonly t: 'skill.load'; readonly skillId: string }
  | { readonly t: 'round'; readonly settled: number; readonly suspended: number }
  | { readonly t: 'memory.capture'; readonly bindings: number }

/**
 * A per-call tool-lifecycle session. Create with {@link createToolLifecycle}.
 */
export interface ToolLifecycle {
  /** False when no tools apply — all methods become no-op passthroughs. */
  readonly enabled: boolean

  /**
   * SDK regime: the merged → middleware-wrapped → instrumented tool map to
   * hand to the SDK. Rebuilt (and approval-middleware re-notified) after a
   * skill amendment. `undefined` in the core regime or when no tools apply.
   */
  readonly tools: Record<string, unknown> | undefined

  /**
   * Core regime: the canonical, schema-sanitized descriptor array for the
   * provider call. Always current — re-read after each round instead of
   * keeping a dialect-local copy. `undefined` in the sdk regime or when no
   * tools apply.
   */
  readonly descriptors: readonly ToolDescriptor[] | undefined

  /**
   * Fire approvalMiddleware `onApproved`/`onDenied` callbacks for decisions
   * found in history, exactly once. Stream paths call this alone; generate
   * paths get it implicitly via `resume()`.
   */
  notifyDecisions(messages: readonly Message[] | undefined): Promise<void>

  /**
   * Resume protocol — once before the first provider call. Finds approval
   * requests whose decision arrived but whose tool result does not exist,
   * verifies tokens (emitting the token-mismatch observation before
   * throwing), replays approved calls through replay-origin gates, settles
   * denied calls as execution-denied outputs, and returns history with the
   * synthetic tool round appended. Idempotent over the same history.
   */
  resume(messages: readonly Message[]): Promise<ToolResumeOutcome>

  /**
   * Core regime only — one full round for the calls the dialect extracted:
   * per call, middleware → approval gate → span wrap → execute → normalize.
   * Suspension is a value, not a throw: stops at the first undecided
   * `needsApproval` and returns the minted request + suspension message.
   * @throws in the `'sdk'` regime (the SDK owns the loop — RFC #28).
   */
  executeRound(response: AdapterResponse, messages: readonly Message[]): Promise<ToolRoundOutcome>

  /**
   * Skill-load side effect, shared verbatim by both regimes: detect
   * `LoadSkill` calls, emit `onSkillLoad`/`onSkillResolve`, invoke the
   * dialect's `reresolve` closure, append skill instructions to the system
   * prompt, re-arm the tool map, and report the amendment (`refundStep`
   * always true — `LoadSkill` never consumes loop budget). `undefined` on
   * the common path.
   */
  applySkillLoads(
    toolCalls: ReadonlyArray<{ readonly name: string; readonly args: unknown }>,
  ): Promise<SkillAmendment | undefined>

  /**
   * SDK regime: seal an SDK-reported suspension — mint approval ids and
   * anti-forgery tokens, append one approval-request message per pending
   * call, emit request observations and `onToolApprovalRequest` hooks.
   */
  suspend(
    pending: ReadonlyArray<{ readonly toolCallId: string; readonly toolName: string; readonly input: JsonValue }>,
    assistantResponse: AdapterResponse,
    messages: readonly Message[],
  ): SuspendedRound

  /**
   * Post-generation memory capture: fan the completed turn into every
   * memory binding, then flush. At-most-once per session — safe to call
   * from both a stream's completion and consumption paths without the
   * dialect keeping a `memoryCaptured` flag. No-op without bindings.
   */
  captureTurn(args: {
    readonly messages: readonly Message[]
    readonly assistantText?: string
    readonly toolCalls?: ReadonlyArray<{ readonly id?: string; readonly name: string; readonly args: unknown }>
  }): Promise<void>

  /** Protocol transcript — see {@link ToolProtocolEvent}. */
  readonly transcript: readonly ToolProtocolEvent[]
}

// ─────────────────────────────────────────────────────────────────
// Internal: descriptor conversion (core regime)
// ─────────────────────────────────────────────────────────────────

/**
 * Convert a (middleware-wrapped) tool map to the canonical descriptor array
 * the core regime hands to providers. Applies optional schema sanitization
 * from the adapter spec.
 */
function convertTools(
  resolvedTools: Record<string, unknown> | undefined,
  sanitizeToolSchema?: (schema: Record<string, unknown>) => Record<string, unknown>,
): ToolDescriptor[] | undefined {
  if (!resolvedTools || Object.keys(resolvedTools).length === 0) return undefined

  return Object.entries(resolvedTools).map(([name, tool]) => {
    const t = tool as {
      description?: string
      parameters?: unknown
      execute?: ToolDescriptor['execute']
      needsApproval?: ToolDescriptor['needsApproval']
      toModelOutput?: ToolDescriptor['toModelOutput']
    }

    // Convert Zod schema to JSON Schema if present
    let parameters: Record<string, unknown> = {}
    if (t.parameters && typeof t.parameters === 'object' && '_zod' in (t.parameters as object)) {
      // Zod v4 schema -- use z.toJSONSchema(). Fail closed: an empty `{}`
      // fallback would advertise a wrong tool contract to the provider.
      try {
        parameters = z.toJSONSchema(t.parameters as z.ZodType) as Record<string, unknown>
      } catch (error) {
        throw new Error(`Tool "${name}": failed to convert Zod parameters to JSON Schema`, { cause: error })
      }
    } else if (t.parameters && typeof t.parameters === 'object') {
      parameters = t.parameters as Record<string, unknown>
    }

    // Apply provider-specific schema sanitization
    if (sanitizeToolSchema) {
      parameters = sanitizeToolSchema(parameters)
    }

    return {
      name,
      description: t.description ?? '',
      parameters,
      execute: t.execute ?? (() => undefined),
      needsApproval: t.needsApproval,
      toModelOutput: t.toModelOutput,
    }
  })
}

/**
 * Structural shape of a (middleware-wrapped) tool as the kernel consumes
 * it. Tool objects are heavily generic in SDK land; the kernel only needs
 * these three members, so structural typing is sufficient.
 */
interface SessionToolShape {
  readonly execute?: (
    input: unknown,
    options: { readonly toolCallId?: string; readonly messages?: readonly unknown[] },
  ) => unknown
  readonly needsApproval?:
    | boolean
    | ((
        input: unknown,
        options: { toolCallId?: string; messages?: readonly Message[] },
      ) => boolean | PromiseLike<boolean>)
  readonly toModelOutput?: (args: {
    toolCallId: string
    input: Record<string, unknown>
    output: unknown
  }) => ToolModelOutput | Promise<ToolModelOutput>
}

/** The canonical tool-round message shape (the sdk regime's only shape). */
function canonicalAppendToolRound(
  messages: Message[],
  response: AdapterResponse,
  results: ToolResultEntry[],
): Message[] {
  return [
    ...messages,
    {
      role: 'assistant' as const,
      content: response.text,
      ...(response.toolCalls ? { metadata: { toolCalls: response.toolCalls } } : {}),
    },
    ...results.map((result) => ({
      role: 'tool' as const,
      content: result.content,
      metadata: { toolCallId: result.toolCallId, toolName: result.name },
    })),
  ]
}

/**
 * The private verdict kernel: `gate()` returns a capability-carrying
 * verdict — the variant IS the only legal continuation, so per-call
 * mis-ordering is unrepresentable. NOT exported: exposing it would let
 * callers bypass `executeRound()`/`resume()` and recreate the old
 * hand-orchestration.
 */
type ToolGateVerdict =
  | { readonly kind: 'execute'; readonly run: () => Promise<ToolResultEntry> }
  | { readonly kind: 'denied'; readonly settled: ToolResultEntry }
  | { readonly kind: 'suspend'; readonly request: ApprovalRequestInfo }
  | { readonly kind: 'not-found'; readonly settled: ToolResultEntry }

interface SessionToolCall {
  readonly id: string
  readonly name: string
  readonly args: unknown
}

function normalizeMiddlewareChain(
  promptMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
  callMiddleware: ToolMiddleware | readonly ToolMiddleware[] | undefined,
): readonly ToolMiddleware[] {
  return [
    ...(Array.isArray(promptMiddleware) ? promptMiddleware : promptMiddleware ? [promptMiddleware] : []),
    ...(Array.isArray(callMiddleware) ? callMiddleware : callMiddleware ? [callMiddleware] : []),
  ]
}

// ─────────────────────────────────────────────────────────────────
// createToolLifecycle
// ─────────────────────────────────────────────────────────────────

/**
 * Create the per-call tool-lifecycle session.
 *
 * Reads runtime instrumentation hooks once at creation and snapshots them,
 * so a mid-call `setRuntime()` cannot half-instrument a run.
 */
export function createToolLifecycle(options: ToolLifecycleOptions): ToolLifecycle {
  const transcript: ToolProtocolEvent[] = []

  // ── Preparation: merge precedence + middleware chain order ──────
  let wrappedTools: Record<string, unknown> = {}
  let armedTools: Record<string, unknown> | undefined
  let descriptors: ToolDescriptor[] | undefined
  let middlewareCount = 0
  let skillSession: SkillActivationSession | undefined

  function arm(resolved: ResolvedPrompt): void {
    skillSession = readSkillActivationSession(resolved)
    // Recomputed per arm: a re-resolved prompt (skill load) can contribute
    // a different middleware chain, and rebuilt tools must wear it.
    const middlewareChain = normalizeMiddlewareChain(resolved.toolMiddleware, options.call?.toolMiddleware)
    const middleware = middlewareChain.length > 0 ? middlewareChain : undefined
    middlewareCount = middlewareChain.length
    const merged = { ...(resolved.tools ?? {}), ...(options.call?.tools ?? {}) }
    wrappedTools = applyToolMiddleware(merged, middleware)
    if (options.regime === 'core') {
      descriptors = convertTools(wrappedTools, options.sanitizeToolSchema)
    } else {
      const keys = Object.keys(wrappedTools)
      armedTools = keys.length > 0 ? instrumentToolSet(wrappedTools) : undefined
    }
  }

  arm(options.resolved)

  const enabled = Object.keys(wrappedTools).length > 0
  transcript.push({ t: 'prepare', tools: Object.keys(wrappedTools).length, middleware: middlewareCount })

  let memoryCaptured = false
  let lastMessages: readonly Message[] | undefined
  const announcedSkills = new Set<string>()

  // Snapshot runtime hooks once — a mid-call setRuntime() cannot
  // half-instrument this run (same rule as createSafety).
  const hooks = getRuntime().instrumentationHooks
  const now = options.now ?? (() => Date.now())
  const mintToken = options.createApprovalToken ?? defaultCreateApprovalToken
  const appendRound: AppendToolRound = options.appendToolRound ?? canonicalAppendToolRound

  const currentTraceId = (): string | undefined => getExecutionContext()?.traceId ?? observe.captureContext()?.traceId

  // ── The kernel: gate → execute → settle ─────────────────────────

  function settleNotFound(toolCall: SessionToolCall, traceId: string | undefined): ToolResultEntry {
    const startedAt = now()
    const span = openToolCallSpan(toolCall.name, toolCall.id, toolCall.args)
    hooks?.onToolStart?.({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.args,
      traceId,
      spanId: span.spanId,
    })
    const modelOutput: ToolModelOutput = {
      type: 'error-json',
      value: { error: `Tool "${toolCall.name}" not found` },
    }
    const modelOutputSize = measureModelOutput(modelOutput)
    span.withContext(() => {
      emitToolArgsArtifact(span.spanId, toolCall.name, toolCall.id, toolCall.args)
      emitToolResultArtifact(span.spanId, toolCall.name, toolCall.id, modelOutput, {
        resultKind: 'model',
        modelOutputType: modelOutput.type,
        modelOutputSize,
        isError: true,
        errorKind: 'tool_not_found',
      })
    })
    hooks?.onToolEnd?.({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      durationMs: now() - startedAt,
      modelOutput,
      modelOutputType: modelOutput.type,
      outputSize: 0,
      modelOutputSize,
      tokenSavingsEstimate: 0,
      error: `Tool "${toolCall.name}" not found`,
      traceId,
      spanId: span.spanId,
    })
    span.error(new Error(`Tool "${toolCall.name}" not found`), {
      isError: true,
      phase: 'tool.lookup',
      errorKind: 'tool_not_found',
      outputSize: 0,
      modelOutputSize,
    })
    return {
      toolCallId: toolCall.id,
      name: toolCall.name,
      modelOutput,
      content: renderToolModelOutput(modelOutput),
      outputSize: 0,
      modelOutputSize,
      isError: true,
    }
  }

  async function runTool(
    toolCall: SessionToolCall,
    tool: SessionToolShape,
    messages: readonly Message[],
    traceId: string | undefined,
  ): Promise<ToolResultEntry> {
    const startedAt = now()
    const span = openToolCallSpan(toolCall.name, toolCall.id, toolCall.args)
    hooks?.onToolStart?.({
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.args,
      traceId,
      spanId: span.spanId,
    })
    try {
      span.withContext(() => emitToolArgsArtifact(span.spanId, toolCall.name, toolCall.id, toolCall.args))
      const execute = tool.execute ?? (() => undefined)
      const result = await span.withContext(() => execute(toolCall.args, { toolCallId: toolCall.id, messages }))
      const modelOutput = await span.withContext(() =>
        createToolModelOutput({
          tool,
          toolCallId: toolCall.id,
          input: normalizeToolInput(toolCall.args),
          output: result,
        }),
      )
      const outputSize = measureUnknown(result)
      const modelOutputSize = measureModelOutput(modelOutput)
      const content = renderToolModelOutput(modelOutput)
      span.withContext(() => {
        emitToolResultArtifact(span.spanId, toolCall.name, toolCall.id, result, {
          resultKind: 'raw',
          outputSize,
          isError: false,
        })
        emitToolResultArtifact(span.spanId, toolCall.name, toolCall.id, modelOutput, {
          resultKind: 'model',
          modelOutputType: modelOutput.type,
          modelOutputSize,
          tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
          isError: false,
        })
      })
      hooks?.onToolEnd?.({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        durationMs: now() - startedAt,
        result,
        modelOutput,
        modelOutputType: modelOutput.type,
        outputSize,
        modelOutputSize,
        tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
        traceId,
        spanId: span.spanId,
      })
      span.end({
        isError: false,
        outputSize,
        modelOutputSize,
        modelOutputType: modelOutput.type,
        tokenSavingsEstimate: Math.max(0, outputSize - modelOutputSize),
      })
      transcript.push({ t: 'execute.settle', toolCallId: toolCall.id, outcome: 'ok' })
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        output: result,
        modelOutput,
        content,
        outputSize,
        modelOutputSize,
      }
    } catch (err) {
      const modelOutput: ToolModelOutput = {
        type: 'error-json',
        value: { error: err instanceof Error ? err.message : String(err) },
      }
      const modelOutputSize = measureModelOutput(modelOutput)
      span.withContext(() => {
        emitToolResultArtifact(span.spanId, toolCall.name, toolCall.id, modelOutput, {
          resultKind: 'model',
          modelOutputType: modelOutput.type,
          modelOutputSize,
          tokenSavingsEstimate: 0,
          isError: true,
          errorKind: 'execute_error',
        })
      })
      hooks?.onToolEnd?.({
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        durationMs: now() - startedAt,
        modelOutput,
        modelOutputType: modelOutput.type,
        outputSize: 0,
        modelOutputSize,
        tokenSavingsEstimate: 0,
        error: err instanceof Error ? err.message : String(err),
        traceId,
        spanId: span.spanId,
      })
      span.error(err, {
        isError: true,
        phase: 'tool.execute',
        errorKind: 'execute_error',
        outputSize: 0,
        modelOutputSize,
        modelOutputType: modelOutput.type,
        tokenSavingsEstimate: 0,
      })
      transcript.push({ t: 'execute.settle', toolCallId: toolCall.id, outcome: 'error' })
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        modelOutput,
        content: renderToolModelOutput(modelOutput),
        outputSize: 0,
        modelOutputSize,
        isError: true,
      }
    }
  }

  async function evaluateNeedsApproval(
    tool: SessionToolShape,
    toolCall: SessionToolCall,
    messages: readonly Message[],
  ): Promise<boolean> {
    if (tool.needsApproval === undefined) return false
    if (typeof tool.needsApproval === 'boolean') return tool.needsApproval
    return Boolean(
      await tool.needsApproval(toolCall.args, { toolCallId: toolCall.id, messages: messages as Message[] }),
    )
  }

  /**
   * The per-call verdict gate. Order is part of the protocol: the history
   * decision (and its token check) comes BEFORE `needsApproval`, so a
   * token mismatch throws even for tools that no longer require approval.
   */
  async function gate(
    toolCall: SessionToolCall,
    messages: readonly Message[],
    origin: 'live' | 'replay',
  ): Promise<ToolGateVerdict> {
    const traceId = currentTraceId()
    const tool = wrappedTools[toolCall.name]
    if (!tool || typeof tool !== 'object') {
      transcript.push({ t: 'gate', toolCallId: toolCall.id, toolName: toolCall.name, verdict: 'not-found', origin })
      return { kind: 'not-found', settled: settleNotFound(toolCall, traceId) }
    }
    const shaped = tool as SessionToolShape

    const approvalId = createApprovalId(toolCall.id)
    const request = findToolApprovalRequests(messages).find((candidate) => candidate.approvalId === approvalId)
    let decision: ReturnType<typeof findValidApprovalDecision>
    try {
      decision = findValidApprovalDecision(messages, request)
    } catch (error) {
      emitToolApprovalObservation('token-mismatch', {
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
        error,
      })
      throw error
    }

    if (decision) {
      if (!decision.approved) {
        const modelOutput = deniedToolModelOutput(decision.reason)
        const modelOutputSize = measureModelOutput(modelOutput)
        emitToolApprovalObservation('denied', {
          approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          input: toolCall.args,
          reason: decision.reason,
          modelOutput,
          modelOutputSize,
        })
        transcript.push({ t: 'gate', toolCallId: toolCall.id, toolName: toolCall.name, verdict: 'denied', origin })
        return {
          kind: 'denied',
          settled: {
            toolCallId: toolCall.id,
            name: toolCall.name,
            modelOutput,
            content: renderToolModelOutput(modelOutput),
            outputSize: 0,
            modelOutputSize,
            isError: true,
          },
        }
      }
      emitToolApprovalObservation('approved', {
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
      })
      transcript.push({ t: 'gate', toolCallId: toolCall.id, toolName: toolCall.name, verdict: 'execute', origin })
      return { kind: 'execute', run: () => runTool(toolCall, shaped, messages, traceId) }
    }

    if (await evaluateNeedsApproval(shaped, toolCall, messages)) {
      const minted: ApprovalRequestInfo = {
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toJsonValue(toolCall.args),
        approvalToken: mintToken(),
      }
      hooks?.onToolApprovalRequest?.({
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
        traceId,
      })
      emitToolApprovalObservation('request', {
        approvalId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        input: toolCall.args,
      })
      transcript.push({ t: 'gate', toolCallId: toolCall.id, toolName: toolCall.name, verdict: 'suspend', origin })
      transcript.push({ t: 'suspend.mint', toolCallId: toolCall.id, approvalId })
      return { kind: 'suspend', request: minted }
    }

    transcript.push({ t: 'gate', toolCallId: toolCall.id, toolName: toolCall.name, verdict: 'execute', origin })
    return { kind: 'execute', run: () => runTool(toolCall, shaped, messages, traceId) }
  }

  // ── Session methods ──────────────────────────────────────────────

  async function notifyDecisions(messages: readonly Message[] | undefined): Promise<void> {
    if (!enabled || !messages) return
    lastMessages = messages
    const decisions = findToolApprovalRequests(messages).filter(
      (request) => findToolApprovalDecision(messages, request.approvalId) !== undefined,
    ).length
    transcript.push({ t: 'decision.notify', decisions })
    await notifyToolApprovalResponses(wrappedTools, messages)
  }

  return {
    enabled,

    get tools() {
      return armedTools
    },

    get descriptors() {
      return descriptors
    },

    notifyDecisions,

    async resume(messages) {
      if (!enabled) return { messages: [...messages], replayed: 0 }
      await notifyDecisions(messages)
      // Token mismatch emits the observation and throws inside the scan.
      const replayCalls = findApprovedOrDeniedToolCalls(messages)
      transcript.push({ t: 'resume', replayed: replayCalls.length })
      if (replayCalls.length === 0) return { messages: [...messages], replayed: 0 }

      const results: ToolResultEntry[] = []
      for (const toolCall of replayCalls) {
        const verdict = await gate(toolCall, messages, 'replay')
        // `suspend` is unreachable here: the scan only returns decided calls
        // and the gate consults the decision before `needsApproval`.
        if (verdict.kind === 'execute') results.push(await verdict.run())
        else if (verdict.kind !== 'suspend') results.push(verdict.settled)
      }
      const synthetic = createSyntheticToolCallResponse(replayCalls)
      return { messages: appendRound([...messages], synthetic, results), replayed: replayCalls.length }
    },

    async executeRound(response, messages) {
      if (options.regime === 'sdk') {
        throw new Error(
          'executeRound() is unavailable in the sdk regime — the SDK owns the tool loop (RFC #28). Hand lifecycle.tools to the SDK instead.',
        )
      }
      // NOT gated on `enabled`: a model can hallucinate a tool call against
      // a tool-less prompt, and the round must settle it as tool_not_found
      // so the model hears the failure.
      const toolCalls = response.toolCalls ?? []
      if (toolCalls.length === 0) {
        return { kind: 'completed', results: [], messages: [...messages] }
      }
      emitToolRequestArtifacts(toolCalls)

      const results: ToolResultEntry[] = []
      for (const toolCall of toolCalls) {
        const verdict = await gate(toolCall, messages, 'live')
        if (verdict.kind === 'suspend') {
          transcript.push({ t: 'round', settled: results.length, suspended: 1 })
          // Settled siblings already executed — persist their results after
          // the approval-request message (which carries the assistant turn
          // and tool calls) so the model hears about the side effects and
          // resume() treats them as completed.
          const siblingMessages: Message[] = results.map((result) => ({
            role: 'tool' as const,
            content: result.content,
            metadata: { toolCallId: result.toolCallId, toolName: result.name },
          }))
          return {
            kind: 'suspended',
            request: verdict.request,
            settled: results,
            messages: [...messages, createApprovalRequestMessage(response, verdict.request), ...siblingMessages],
          }
        }
        results.push(verdict.kind === 'execute' ? await verdict.run() : verdict.settled)
      }
      transcript.push({ t: 'round', settled: results.length, suspended: 0 })
      return { kind: 'completed', results, messages: appendRound([...messages], response, results) }
    },

    async applySkillLoads(toolCalls) {
      if (!skillSession || !options.reresolve) return undefined
      const loadCalls = toolCalls.filter((toolCall) => toolCall.name === LOAD_SKILL_TOOL_NAME)
      if (loadCalls.length === 0) return undefined

      // Announce newly active skills exactly once per session.
      const newSkills = skillSession.newlyActivated()
      for (const loadedSkill of newSkills) {
        if (announcedSkills.has(loadedSkill.id)) continue
        announcedSkills.add(loadedSkill.id)
        hooks?.onSkillLoad?.({ skillId: loadedSkill.id, source: 'inline' })
        transcript.push({ t: 'skill.load', skillId: loadedSkill.id })
      }

      // Re-resolve — activated skills now contribute their full instructions.
      const reResolved = await options.reresolve(skillSession)
      const updatedSystem = reResolved.system ?? ''
      for (const loadedSkill of newSkills) {
        hooks?.onSkillResolve?.({ skillId: loadedSkill.id })
      }
      skillSession.markInjected(newSkills.map((entry) => entry.id))

      // Re-arm the surface and re-notify approval middleware against the
      // REBUILT tool instances (decision dedup keeps this idempotent).
      arm(reResolved)
      await notifyToolApprovalResponses(wrappedTools, lastMessages)

      return { system: updatedSystem, systemBlocks: reResolved.systemBlocks, refundStep: true }
    },

    suspend(pending, assistantResponse, messages) {
      if (options.regime === 'core') {
        throw new Error(
          'suspend() is unavailable in the core regime — executeRound() returns suspension as a value instead.',
        )
      }
      const traceId = currentTraceId()
      const requests: ApprovalRequestInfo[] = pending.map((pendingCall) => ({
        approvalId: createApprovalId(pendingCall.toolCallId),
        toolCallId: pendingCall.toolCallId,
        toolName: pendingCall.toolName,
        input: pendingCall.input,
        approvalToken: mintToken(),
      }))

      let sealedMessages = [...messages]
      for (const request of requests) {
        hooks?.onToolApprovalRequest?.({
          approvalId: request.approvalId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          input: request.input,
          traceId,
        })
        emitToolApprovalObservation('request', {
          approvalId: request.approvalId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          input: request.input,
        })
        transcript.push({ t: 'suspend.mint', toolCallId: request.toolCallId, approvalId: request.approvalId })
        sealedMessages = [...sealedMessages, createApprovalRequestMessage(assistantResponse, request)]
      }
      return { messages: sealedMessages, requests }
    },

    // Keyed on memory bindings, not `enabled` — a prompt can bind memory
    // without declaring any tools.
    async captureTurn(args) {
      if (memoryCaptured) return
      memoryCaptured = true
      const bindings = options.resolved.memoryBindings?.length ?? 0
      if (bindings === 0) return
      transcript.push({ t: 'memory.capture', bindings })
      await captureMemoryTurn(options.resolved, {
        promptId: options.promptId,
        input: options.input ?? {},
        messages: [...args.messages],
        assistantText: args.assistantText,
        toolCalls: args.toolCalls?.map((toolCall) => ({
          id: toolCall.id,
          name: toolCall.name,
          args: toolCall.args,
        })),
      })
    },

    transcript,
  }
}
