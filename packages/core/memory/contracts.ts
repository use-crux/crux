import type { Context } from '../prompt/context-types'
import type { CruxStore } from '../store/types'
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
  /** Stable identifier used in store keys, traces, and devtools resources. */
  id: string
  /** Store backing this memory instance. Defaults to an in-memory store. */
  store?: CruxStore
  /** Namespace scope for all reads, writes, tools, capture, and proposals. */
  namespace: MemoryNamespace
  /** Ordered memory blocks composed by this memory instance. */
  blocks: readonly MemoryBlock[]
  /**
   * Capture scheduling behavior for turn and tool-event writes.
   *
   * Defaults to `afterResponse`.
   */
  capture?: MemoryCaptureConfig
  /**
   * @deprecated Use `capture` instead. Legacy `deferred` maps to
   * `capture.mode: "afterResponse"` and legacy `manual` maps to
   * `capture.mode: "detached"` because capture still starts immediately.
   */
  processing?: {
    mode?: 'deferred' | 'inline' | 'manual'
    waitUntil?: (promise: Promise<unknown>) => void
  }
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
  /** Stable identifier used in store keys, traces, and devtools resources. */
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
  /** Capture a completed turn using the configured capture mode. */
  captureTurn(
    turn: MemoryTurn,
    options?: Partial<MemoryRuntimeOptions> & {
      input?: Record<string, unknown>
    },
  ): Promise<void>
  /** Capture a completed tool event using the configured capture mode. */
  captureToolEvent(
    event: MemoryToolEvent,
    options?: Partial<MemoryRuntimeOptions> & {
      input?: Record<string, unknown>
    },
  ): Promise<void>
  /** Await pending memory work for this namespace. */
  flush(
    options?: Partial<MemoryRuntimeOptions> & {
      input?: Record<string, unknown>
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
