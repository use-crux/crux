import type { ZodType } from 'zod'
import type { CruxStore } from '../store/types'
import type { AnyToolSet } from '../types'
import type { MemoryBudget } from './rendering'

/**
 * Built-in memory block categories surfaced in traces, Project Index metadata,
 * and devtools.
 */
export type MemoryBlockKind =
  | 'recent'
  | 'working'
  | 'episodes'
  | 'facts'
  | 'procedures'
  | 'reflections'
  | 'custom'

/**
 * Write behavior for blocks that extract durable memory from turns.
 *
 * `propose` stores a reviewable proposal, `auto` writes immediately after
 * policy checks, and `manual` leaves writes to direct application calls.
 */
export type MemoryWriteMode = 'propose' | 'auto' | 'manual'

/** Review state for a proposed long-term memory write. */
export type MemoryProposalStatus = 'pending' | 'approved' | 'rejected'

/**
 * Capture scheduling mode for turn and tool-event memory writes.
 *
 * - `inline`: await capture before the caller continues.
 * - `afterResponse`: start capture after generation and hand it to `waitUntil`
 *   when available.
 * - `detached`: start capture in the background and let `flush()` await it.
 */
export type MemoryCaptureMode = 'inline' | 'afterResponse' | 'detached'

/** Capture scheduling options for memory turn and tool-event writes. */
export interface MemoryCaptureConfig {
  /** Capture scheduling mode. Defaults to `afterResponse`. */
  mode?: MemoryCaptureMode
  /** Runtime hook for environments that keep background work alive after a response. */
  waitUntil?: (promise: Promise<unknown>) => void
}

/**
 * Runtime coordinates used by direct block methods.
 *
 * Pass the composed `memory()` id as `memoryId` when direct reads and writes
 * should share storage keys with prompt-bound memory.
 */
export interface MemoryRuntimeOptions {
  /** Store used for block reads, writes, listing, and optional vector search. */
  store: CruxStore
  /** Stable tenant, user, thread, session, or agent scope. */
  namespace: string
  /** Composed memory id used in storage keys. Defaults to `standalone`. */
  memoryId?: string
  /** Optional trace correlation id for observability. */
  traceId?: string
  /** Optional prompt id for capture and proposal provenance. */
  promptId?: string
}

/** Tool call data available to memory capture. */
export interface MemoryToolEvent {
  /** Provider or runtime tool-call id, when available. */
  toolCallId?: string
  /** Tool name as exposed to the model. */
  toolName: string
  /** Tool arguments captured before execution. */
  args?: unknown
  /** Tool result captured after successful execution. */
  result?: unknown
  /** Tool error message captured after failed execution. */
  error?: string
}

/** A single message available to memory capture. */
export interface MemoryMessage {
  /** Message role, such as `user`, `assistant`, `system`, or `tool`. */
  role: string
  /** Text content available for memory extraction. */
  content: string
  /** Product-specific metadata to preserve with captured memory. */
  metadata?: Record<string, unknown>
}

/** Completed interaction data passed to block capture hooks. */
export interface MemoryTurn {
  /** Optional stable turn id for provenance. */
  id?: string
  /** Messages that should be considered for capture. */
  messages: MemoryMessage[]
  /** Tool events observed during the turn. */
  toolEvents?: MemoryToolEvent[]
  /** Trace and prompt provenance for writes or proposals. */
  source?: {
    traceId?: string
    promptId?: string
  }
  /** Product-specific capture metadata. */
  metadata?: Record<string, unknown>
}

/** Reviewable long-term memory candidate created by a block. */
export interface MemoryProposal {
  /** Stable proposal id. */
  id: string
  /** Composed memory id that owns the proposal. */
  memoryId: string
  /** Block id that produced the proposal. */
  blockId: string
  /** Block kind that produced the proposal. */
  blockKind: MemoryBlockKind
  /** Namespace where approval will write memory. */
  namespace: string
  /** Current review state. Terminal proposals cannot be approved or edited again. */
  status: MemoryProposalStatus
  /** Candidate payload understood by the producing block. */
  candidate: unknown
  /** Optional source data used for audit and devtools. */
  source?: {
    turnId?: string
    traceId?: string
    promptId?: string
    toolCallId?: string
  }
  /** Creation timestamp in milliseconds since Unix epoch. */
  createdAt: number
  /** Last update timestamp in milliseconds since Unix epoch. */
  updatedAt: number
  /** Optional rejection or proposal reason. */
  reason?: string
}

/** Product policy hook for proposed or automatic memory candidates. */
export interface MemoryPolicy<TCandidate> {
  /** Return false to drop a candidate before it becomes a proposal or write. */
  shouldRemember?: (
    candidate: TCandidate,
    ctx: MemoryBlockContext,
  ) => boolean | Promise<boolean>
  /** Redact or normalize candidate data before validation and persistence. */
  redact?: (
    candidate: TCandidate,
    ctx: MemoryBlockContext,
  ) => TCandidate | Promise<TCandidate>
  /** Zod validator for the final candidate shape. */
  validate?: ZodType<TCandidate>
}

/** Context passed to block render, tool, capture, flush, and proposal hooks. */
export interface MemoryBlockContext extends MemoryRuntimeOptions {
  /** Prompt input used to derive dynamic namespaces or render queries. */
  input?: Record<string, unknown>
  /** Store a reviewable proposal for this memory namespace. */
  propose(
    candidate: unknown,
    options: { block: MemoryBlock; source?: MemoryProposal['source'] },
  ): Promise<string>
}

/** A composable unit of memory read, render, write, tool, and review behavior. */
export interface MemoryBlock {
  readonly _tag: 'MemoryBlock'
  /** Stable block id used in storage keys, traces, and index metadata. */
  readonly id: string
  /** Semantic block category. */
  readonly kind: MemoryBlockKind
  /** Higher-priority blocks render before lower-priority blocks. */
  readonly priority: number
  /** Optional token budget for this block's rendered body. */
  readonly budget?: MemoryBudget
  /** Render block state into prompt context. */
  render?(ctx: MemoryBlockContext): Promise<string> | string
  /** Expose block tools for model calls. */
  tools?(ctx: MemoryBlockContext): AnyToolSet | Promise<AnyToolSet>
  /** Capture a completed turn. */
  captureTurn?(turn: MemoryTurn, ctx: MemoryBlockContext): Promise<void>
  /** Capture a completed tool event. */
  captureToolEvent?(
    event: MemoryToolEvent,
    ctx: MemoryBlockContext,
  ): Promise<void>
  /** Await pending block work. */
  flush?(ctx: MemoryBlockContext): Promise<void>
  /** Apply an approved proposal, optionally with a reviewer edit. */
  approveProposal?(
    proposal: MemoryProposal,
    ctx: MemoryBlockContext,
    edit?: unknown,
  ): Promise<void>
}

/** Configuration for custom `memoryBlock()` instances. */
export interface MemoryBlockConfig {
  /** Stable block id used in storage keys, traces, and index metadata. */
  id: string
  /** Semantic block category. Defaults to `custom`. */
  kind?: MemoryBlockKind
  /** Higher-priority blocks render before lower-priority blocks. */
  priority?: number
  /** Approximate token budget for this block's rendered body. */
  budget?: MemoryBudget
  /** Render block state into prompt context. */
  render?: (ctx: MemoryBlockContext) => Promise<string> | string
  /** Expose block tools for model calls. */
  tools?: (ctx: MemoryBlockContext) => AnyToolSet | Promise<AnyToolSet>
  /** Capture a completed turn. */
  captureTurn?: (turn: MemoryTurn, ctx: MemoryBlockContext) => Promise<void>
  /** Capture a completed tool event. */
  captureToolEvent?: (
    event: MemoryToolEvent,
    ctx: MemoryBlockContext,
  ) => Promise<void>
  /** Await pending block work. */
  flush?: (ctx: MemoryBlockContext) => Promise<void>
  /** Apply an approved proposal, optionally with a reviewer edit. */
  approveProposal?: (
    proposal: MemoryProposal,
    ctx: MemoryBlockContext,
    edit?: unknown,
  ) => Promise<void>
}
