import type { Context } from '../prompt/context-types'
import type { RecordStore, Storage, VectorStore } from '../storage'
import type { AnyToolSet } from '../types'
import type { MemoryNamespace } from './namespace'
import type { MemoryBudget } from './rendering'
import type {
  MemoryBlock,
  MemoryCaptureConfig,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
} from './block-contracts'

export type { MemoryNamespace } from './namespace'
export type {
  MemoryBudget,
  MemoryEntryRenderStrategy,
  MemoryListRenderStrategy,
  MemoryRenderQuery,
  MemorySemanticRenderStrategy,
} from './rendering'
export type {
  MemoryBlock,
  MemoryBlockConfig,
  MemoryBlockContext,
  MemoryBlockKind,
  MemoryCaptureConfig,
  MemoryCaptureMode,
  MemoryMessage,
  MemoryPolicy,
  MemoryProposal,
  MemoryProposalStatus,
  MemoryRuntimeOptions,
  MemoryToolEvent,
  MemoryTurn,
  MemoryWriteMode,
} from './block-contracts'

/** Configuration for `memory()`, the top-level memory composition primitive. */
export interface MemoryConfig {
  /** Stable identifier used in record keys, traces, and devtools resources. */
  id: string
  /**
   * Storage bundle backing this memory instance.
   *
   * When omitted, memory uses an in-process bundle from `inMemoryStorage()`.
   * Pass `records` and optionally `vectors` directly when only those
   * capabilities should be shared with memory.
   */
  storage?: Storage
  /** Record store backing block reads, writes, proposal state, and listings. */
  records?: RecordStore
  /** Optional vector store used by semantic recall when a block has an embedder. */
  vectors?: VectorStore
  /** Namespace scope for all reads, writes, tools, capture, and proposals. */
  namespace: MemoryNamespace
  /** Ordered memory blocks composed by this memory instance. */
  blocks: readonly MemoryBlock[]
  /**
   * Capture scheduling behavior for turn and tool-event writes.
   *
   * Deferred capture uses retained execution-scope work when the active host
   * supports it. Otherwise Crux captures inline and safely waits for the write.
   *
   * @default { mode: 'deferred' }
   */
  capture?: MemoryCaptureConfig
  /**
   * Approximate token budget for the composed memory context.
   *
   * Blocks are rendered in priority order. Block-level budgets trim individual
   * block bodies first, then this memory-level budget keeps higher-priority
   * sections before lower-priority sections.
   */
  budget?: MemoryBudget
}

/** Composed memory object usable from prompts, agents, and application code. */
export interface Memory {
  readonly _tag: 'Memory'
  /** Stable identifier used in record keys, traces, and devtools resources. */
  readonly id: string
  readonly blocks: readonly MemoryBlock[]
  readonly config: MemoryConfig
  /** Return a prompt context that renders memory and binds capture hooks. */
  asContext(options?: { priority?: number }): Context
  /** Return tools exposed by memory blocks. Async namespaces/tools throw here. */
  asTools(options?: {
    input?: Record<string, unknown>
    namespace?: string
  }): AnyToolSet
  /**
   * Capture one completed turn using the configured capture mode.
   *
   * Inline capture and the safe fallback for environments without retained
   * work are awaited. Their failures reject this call. Retained deferred
   * failures are reported by {@link Memory.flush} after the owning operation
   * has already returned.
   */
  captureTurn(
    turn: MemoryTurn,
    options?: Readonly<Partial<MemoryRuntimeOptions>> & {
      readonly input?: Record<string, unknown>
    },
  ): Promise<void>
  /**
   * Capture one standalone tool event using the configured capture mode.
   *
   * Tool events already included in a completed {@link MemoryTurn} are
   * captured by {@link Memory.captureTurn} and must not be submitted again.
   */
  captureToolEvent(
    event: MemoryToolEvent,
    options?: Readonly<Partial<MemoryRuntimeOptions>> & {
      readonly input?: Record<string, unknown>
    },
  ): Promise<void>
  /**
   * Settle memory capture work accepted before this call.
   *
   * Capture work is awaited to a call-time cutoff, then each block's `flush`
   * hook runs in declaration order. The promise rejects with the first
   * unobserved deferred capture failure or block-flush failure.
   *
   * Call this after the owning generation has returned. Calling it from the
   * same still-open scope can wait for work that starts only when that scope
   * closes.
   */
  flush(
    options?: Readonly<Partial<MemoryRuntimeOptions>> & {
      readonly input?: Record<string, unknown>
    },
  ): Promise<void>
  /** Review and manage proposed long-term memory writes. */
  proposals: {
    /** List proposals for a namespace, optionally filtered by block and status. */
    list(options?: {
      namespace?: string
      input?: Record<string, unknown>
      promptId?: string
      blockId?: string
      status?: MemoryProposalStatus
    }): Promise<MemoryProposal[]>
    /** Approve a pending proposal and write it through the producing block. */
    approve(
      id: string,
      options?: {
        namespace?: string
        input?: Record<string, unknown>
        promptId?: string
        edit?: unknown
      },
    ): Promise<void>
    /** Reject a pending proposal without writing memory. */
    reject(
      id: string,
      options?: {
        namespace?: string
        input?: Record<string, unknown>
        promptId?: string
        reason?: string
      },
    ): Promise<void>
    /** Edit a pending proposal candidate without approving it. */
    edit(
      id: string,
      patch: unknown,
      options?: {
        namespace?: string
        input?: Record<string, unknown>
        promptId?: string
      },
    ): Promise<void>
  }
}
