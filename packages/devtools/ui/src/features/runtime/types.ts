export type RuntimeWorkStatus =
  | "pending"
  | "leased"
  | "suspended"
  | "completed"
  | "cancelled"
  | "blocked"
  | "dead-letter";

export type RuntimeTimerState = "scheduled" | "fired" | "cancelled";
export type RuntimeOutboxState = "pending" | "dispatched" | "confirmed";

export interface RuntimeStatusCount {
  readonly status: RuntimeWorkStatus;
  readonly namespace: string;
  readonly targetId: string;
  readonly count: number;
  readonly truncated?: boolean;
}

export interface RuntimeLastError {
  readonly code: string;
  readonly message: string;
  readonly at: string;
}

export interface RuntimeWorkRow {
  readonly workId: string;
  readonly namespace: string;
  readonly targetId: string;
  readonly status: RuntimeWorkStatus;
  readonly work: { readonly kind: string; readonly [key: string]: unknown };
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly notBefore?: string;
  readonly idempotencyKey?: string;
  readonly idleScope?: string;
  readonly lastError?: RuntimeLastError;
  readonly resultRef?: RuntimeResultRef;
  readonly application?: {
    readonly progress?: { readonly message?: string };
    readonly ownership: RuntimeWorkOwnership;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RuntimeResultRef {
  readonly sha256: string;
  readonly size?: number;
  readonly mediaType?: string;
  readonly location?: string;
}

export type RuntimeWorkOwnership =
  | { readonly state: "attached" }
  | {
      readonly state: "detached";
      readonly reason?: string;
      readonly detachedAt?: string;
    };

export interface RuntimeApplicationWorkInspect {
  readonly inputDigest?: string;
  readonly definition?: {
    readonly targetId: string;
    readonly definitionId: string;
    readonly fingerprint: string;
    readonly manifestHash: string;
  };
  readonly effects?: {
    readonly kind: "effect.scope";
    readonly id: string;
    readonly runId: string;
  };
  readonly ownership: RuntimeWorkOwnership;
  readonly statistics?: unknown;
  readonly result: { readonly available: boolean; readonly ref?: RuntimeResultRef };
  readonly events: readonly { readonly eventId: string; readonly name: string }[];
}

export interface RuntimeTimerRow {
  readonly timerId: string;
  readonly namespace: string;
  readonly state: RuntimeTimerState;
  readonly fireAt: string;
  readonly workId?: string;
  readonly waiterId?: string;
  readonly idleScope?: string;
  readonly work: { readonly kind: string; readonly [key: string]: unknown };
}

export interface RuntimeOutboxRow {
  readonly outboxId: string;
  readonly namespace: string;
  readonly state: RuntimeOutboxState;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly envelope: {
    readonly workId: string;
    readonly target: string;
    readonly kind: string;
    readonly attempt: number;
    readonly [key: string]: unknown;
  };
}

export interface RuntimeTransportBindingHealthRow {
  readonly schema: 1;
  readonly namespace: string;
  readonly bindingId: string;
  readonly adapterId: string;
  readonly provider: string;
  readonly transportKind: string;
  readonly status: string;
  readonly statusCoverage: string;
  readonly lease: {
    readonly coverage: string;
    readonly ownerId?: string;
  };
  readonly cursor: {
    readonly present: boolean;
    readonly coverage: string;
    readonly ageMs?: number;
    readonly lagCoverage: string;
  };
  readonly outcomes: {
    readonly coverage: string;
    readonly accepted?: number;
    readonly deduplicated?: number;
    readonly delivered?: number;
    readonly retried?: number;
    readonly deadLettered?: number;
  };
  readonly fault: {
    readonly coverage: string;
    readonly lastErrorCode?: string;
  };
  readonly reconnect: {
    readonly coverage: string;
  };
  readonly shutdown: {
    readonly coverage: string;
  };
  readonly configRef?: {
    readonly id: string;
    readonly revision: string;
  };
  readonly target?: {
    readonly kind: string;
    readonly signalId: string;
  };
}

export interface RuntimeTransportBindingHealthSnapshot {
  readonly schema: 1;
  readonly namespace: string;
  readonly observedAt: string;
  readonly bindings: readonly RuntimeTransportBindingHealthRow[];
  readonly totals: {
    readonly accepted: number;
    readonly deduplicated: number;
    readonly delivered: number;
    readonly retried: number;
    readonly deadLettered: number;
    readonly normalized?: number;
  };
  readonly coverage: {
    readonly bindingLimit: number;
    readonly bindings: string;
    readonly identityAttribution: string;
    readonly checkpoints: string;
    readonly statistics: string;
  };
}

export interface RuntimeStatusResponse {
  readonly operation: "status";
  readonly ok: true;
  readonly namespace: string;
  readonly counts: readonly RuntimeStatusCount[];
  readonly work: readonly RuntimeWorkRow[];
  readonly timers: readonly RuntimeTimerRow[];
  readonly outbox: readonly RuntimeOutboxRow[];
  readonly transports?: RuntimeTransportBindingHealthSnapshot;
}

export interface RuntimeInspectResponse {
  readonly operation: "inspect";
  readonly ok: boolean;
  readonly namespace: string;
  readonly work?: RuntimeWorkRow;
  readonly flow?: {
    readonly flowId: string;
    readonly status: string;
    readonly fingerprint: readonly string[];
    readonly pendingSuspends: readonly unknown[];
  };
  readonly application?: RuntimeApplicationWorkInspect;
}

export interface RuntimeRetryResponse {
  readonly operation: "retry";
  readonly ok: boolean;
  readonly namespace: string;
  readonly retried: boolean;
  readonly work?: RuntimeWorkRow;
}

export interface RuntimeCancelResponse {
  readonly operation: "cancel";
  readonly ok: boolean;
  readonly namespace: string;
  readonly cancelled: boolean;
}

export interface RuntimeWorkFilters {
  readonly status?: RuntimeWorkStatus | "all";
  readonly namespace?: string;
  readonly targetId?: string;
}
