export type RuntimeWorkStatus =
  | 'pending'
  | 'leased'
  | 'suspended'
  | 'completed'
  | 'cancelled'
  | 'blocked'
  | 'dead-letter'

export type RuntimeTimerState = 'scheduled' | 'fired' | 'cancelled'
export type RuntimeOutboxState = 'pending' | 'dispatched' | 'confirmed'

export interface RuntimeStatusCount {
  readonly status: RuntimeWorkStatus
  readonly namespace: string
  readonly targetId: string
  readonly count: number
  readonly truncated?: boolean
}

export interface RuntimeLastError {
  readonly code: string
  readonly message: string
  readonly at: string
}

export interface RuntimeWorkRow {
  readonly workId: string
  readonly namespace: string
  readonly targetId: string
  readonly status: RuntimeWorkStatus
  readonly work: { readonly kind: string; readonly [key: string]: unknown }
  readonly attempt: number
  readonly maxAttempts: number
  readonly notBefore?: string
  readonly idempotencyKey?: string
  readonly idleScope?: string
  readonly lastError?: RuntimeLastError
  readonly createdAt: string
  readonly updatedAt: string
}

export interface RuntimeTimerRow {
  readonly timerId: string
  readonly namespace: string
  readonly state: RuntimeTimerState
  readonly fireAt: string
  readonly workId?: string
  readonly waiterId?: string
  readonly idleScope?: string
  readonly work: { readonly kind: string; readonly [key: string]: unknown }
}

export interface RuntimeOutboxRow {
  readonly outboxId: string
  readonly namespace: string
  readonly state: RuntimeOutboxState
  readonly attempts: number
  readonly nextAttemptAt: string
  readonly envelope: {
    readonly workId: string
    readonly target: string
    readonly kind: string
    readonly attempt: number
    readonly [key: string]: unknown
  }
}

export interface RuntimeStatusResponse {
  readonly operation: 'status'
  readonly ok: true
  readonly namespace: string
  readonly counts: readonly RuntimeStatusCount[]
  readonly work: readonly RuntimeWorkRow[]
  readonly timers: readonly RuntimeTimerRow[]
  readonly outbox: readonly RuntimeOutboxRow[]
}

export interface RuntimeInspectResponse {
  readonly operation: 'inspect'
  readonly ok: boolean
  readonly namespace: string
  readonly work?: RuntimeWorkRow
  readonly flow?: {
    readonly flowId: string
    readonly status: string
    readonly fingerprint: readonly string[]
    readonly pendingSuspends: readonly unknown[]
  }
}

export interface RuntimeRetryResponse {
  readonly operation: 'retry'
  readonly ok: boolean
  readonly namespace: string
  readonly retried: boolean
  readonly work?: RuntimeWorkRow
}

export interface RuntimeCancelResponse {
  readonly operation: 'cancel'
  readonly ok: boolean
  readonly namespace: string
  readonly cancelled: boolean
}

export interface RuntimeWorkFilters {
  readonly status?: RuntimeWorkStatus | 'all'
  readonly namespace?: string
  readonly targetId?: string
}
