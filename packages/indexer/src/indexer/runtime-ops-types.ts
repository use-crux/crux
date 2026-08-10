import type {
  FlowSnapshot,
  RuntimeEvent,
  RuntimeOutboxItem,
  RuntimeSetupPort,
  RuntimeTimerRecord,
  RuntimeWorkItem,
  RuntimeWorkState,
} from '@use-crux/core/runtime'

/** Runtime operation command executed by Crux Local's TypeScript worker. */
export type RuntimeOperationKind =
  | 'preflight'
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
  /** Include bounded work/timer/outbox rows with `status` for devtools views. */
  readonly includeDetails?: boolean
}

/** JSON-safe result for one Runtime Engine operation. */
export type RuntimeOperationResult =
  | RuntimePreflightOperationResult
  | RuntimeStatusOperationResult
  | RuntimeInspectOperationResult
  | RuntimeRetryOperationResult
  | RuntimeCancelOperationResult

export interface RuntimePreflightOperationResult {
  readonly operation: 'preflight'
  readonly ok: boolean
  readonly namespace?: string
  readonly setup: Awaited<ReturnType<RuntimeSetupPort['check']>>
  readonly missingTargets: readonly RuntimePreflightMissingTarget[]
}

export interface RuntimePreflightMissingTarget {
  readonly targetId: string
  readonly count: number
}

export interface RuntimeStatusOperationResult {
  readonly operation: 'status'
  readonly ok: true
  readonly namespace: string
  readonly counts: readonly RuntimeStatusCount[]
  readonly work?: readonly RuntimeWorkItem[]
  readonly timers?: readonly RuntimeTimerRecord[]
  readonly outbox?: readonly RuntimeOutboxItem[]
  /**
   * Bounded managed-transport binding health when a generated program and
   * transport store port are available.
   */
  readonly transports?: RuntimeTransportBindingHealthSnapshot
}

/** Secret-free binding health snapshot projected into Runtime status. */
export interface RuntimeTransportBindingHealthSnapshot {
  readonly schema: 1
  readonly namespace: string
  readonly observedAt: string
  readonly bindings: readonly Record<string, unknown>[]
  readonly totals: Record<string, unknown>
  readonly coverage: Record<string, unknown>
}

export interface RuntimeStatusCount {
  readonly status: RuntimeWorkState
  readonly namespace: string
  readonly targetId: string
  readonly count: number
  readonly truncated?: boolean
}

export interface RuntimeInspectOperationResult {
  readonly operation: 'inspect'
  readonly ok: boolean
  readonly namespace: string
  readonly work?: RuntimeWorkItem
  readonly flow?: {
    readonly flowId: string
    readonly status: string
    readonly fingerprint: readonly string[]
    readonly pendingSuspends: readonly unknown[]
  }
  /** Safe application Work identity and lineage retained by the Runtime. */
  readonly application?: RuntimeApplicationWorkInspect
}

/** Bounded Work-specific read model consumed by local operator tooling. */
export interface RuntimeApplicationWorkInspect {
  readonly inputDigest?: string
  readonly definition?: FlowSnapshot['definition']
  readonly effects?: FlowSnapshot['effects']
  readonly ownership: NonNullable<RuntimeWorkItem['application']>['ownership']
  readonly statistics?: NonNullable<RuntimeWorkItem['application']>['statistics']
  readonly result: {
    readonly available: boolean
    readonly ref?: RuntimeWorkItem['resultRef']
  }
  readonly events: readonly RuntimeEvent[]
}

export interface RuntimeRetryOperationResult {
  readonly operation: 'retry'
  readonly ok: boolean
  readonly namespace: string
  readonly retried: boolean
  readonly work?: RuntimeWorkItem
  readonly dispatch?: { readonly delivered: number; readonly failed: number }
}

export interface RuntimeCancelOperationResult {
  readonly operation: 'cancel'
  readonly ok: boolean
  readonly namespace: string
  readonly cancelled: boolean
}
