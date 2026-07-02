import type {
  RuntimeSetupPort,
  WorkItem,
  WorkStatus,
} from '@use-crux/core/runtime'

/** Runtime operation command executed by Crux Local's TypeScript worker. */
export type RuntimeOperationKind =
  | 'setup-check'
  | 'setup-apply'
  | 'status'
  | 'inspect'
  | 'retry'
  | 'cancel'

/** Options for executing one Runtime Engine operation from local tooling. */
export interface RuntimeOperationOptions {
  /** Project root containing `crux.config.*` and generated runtime artifacts. */
  readonly root: string
  /** Operation to execute. */
  readonly operation: RuntimeOperationKind
  /** Work id for `inspect`, `retry`, and `cancel`. */
  readonly workId?: string
}

/** JSON-safe result for one Runtime Engine operation. */
export type RuntimeOperationResult =
  | RuntimeSetupOperationResult
  | RuntimeStatusOperationResult
  | RuntimeInspectOperationResult
  | RuntimeRetryOperationResult
  | RuntimeCancelOperationResult

export interface RuntimeSetupOperationResult {
  readonly operation: 'setup-check' | 'setup-apply'
  readonly ok: boolean
  readonly setup: Awaited<ReturnType<RuntimeSetupPort['check']>>
}

export interface RuntimeStatusOperationResult {
  readonly operation: 'status'
  readonly ok: true
  readonly namespace: string
  readonly counts: readonly RuntimeStatusCount[]
}

export interface RuntimeStatusCount {
  readonly status: WorkStatus
  readonly namespace: string
  readonly targetId: string
  readonly count: number
}

export interface RuntimeInspectOperationResult {
  readonly operation: 'inspect'
  readonly ok: boolean
  readonly namespace: string
  readonly work?: WorkItem
  readonly flow?: {
    readonly flowId: string
    readonly status: string
    readonly fingerprint: readonly string[]
    readonly pendingSuspends: readonly unknown[]
  }
}

export interface RuntimeRetryOperationResult {
  readonly operation: 'retry'
  readonly ok: boolean
  readonly namespace: string
  readonly retried: boolean
  readonly work?: WorkItem
  readonly dispatch?: { readonly delivered: number; readonly failed: number }
}

export interface RuntimeCancelOperationResult {
  readonly operation: 'cancel'
  readonly ok: boolean
  readonly namespace: string
  readonly cancelled: boolean
}
