/**
 * In-memory owner of effect receipt and recovery state.
 *
 * @internal
 * @module
 */

import type {
  EffectReceipt,
  EffectScopeRecord,
  RecoveryUnitLifecycle,
  RecoveryUnitRecord,
} from "../receipt-types";
import type {
  EffectOutcome,
  RecoveryAvailability,
} from "../receipt-types";
import type {
  EffectReceiptRef,
  EffectResource,
  RecoverOptions,
} from "../types";

/** Ephemeral recovery data retained only inside the in-memory ledger. */
export interface StoredRecoveryEnvelope {
  /** Envelope schema version. */
  readonly schemaVersion: 1;
  /** Original receipt identifier. */
  readonly receiptId: string;
  /** Effect definition identifier. */
  readonly effectId: string;
  /** Effect definition version. */
  readonly effectVersion: number;
  /** Original input, retained by reference. */
  readonly input: unknown;
  /** Settled output, retained by reference. */
  readonly output: unknown;
  /** Captured pre-state, when configured. */
  readonly captured?: unknown;
  /** Envelope creation time in epoch milliseconds. */
  readonly createdAt: number;
  /** Whether every retained value is JSON-safe. */
  readonly durable: boolean;
}

/** Input supplied by the ledger to a registered recovery handler. */
export interface RecoveryHandlerInvocation {
  /** Retained recovery data. */
  readonly envelope: StoredRecoveryEnvelope;
  /** Original receipt reference. */
  readonly receipt: EffectReceiptRef;
  /** Safe projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Stable unit idempotency key. */
  readonly idempotencyKey: string;
  /** Caller recovery options. */
  readonly options?: RecoverOptions;
}

/** Recovery unit with its in-process handler binding. */
export interface RegisteredRecoveryUnit extends RecoveryUnitRecord {
  /** Invoke the exact definition version registered for this unit. */
  readonly execute: (
    invocation: RecoveryHandlerInvocation,
  ) => Promise<void>;
}

/** Fields required to allocate a preparing receipt. */
export interface EffectReceiptInit {
  /** Stable receipt identifier. */
  readonly id: string;
  /** Stable effect identifier. */
  readonly effectId: string;
  /** Effect contract version. */
  readonly effectVersion: number;
  /** Owning execution scope identifier. */
  readonly scopeId: string;
  /** Nearest rollback boundary identifier. */
  readonly boundaryId: string;
  /** Containing run identifier. */
  readonly runId?: string;
  /** Initial recovery availability. */
  readonly recovery: RecoveryAvailability;
  /** Execution start time in epoch milliseconds. */
  readonly startedAt: number;
}

/** Monotonic patch applied to an existing receipt. */
export interface ReceiptTransition {
  /** Next lifecycle outcome. */
  readonly outcome: Exclude<EffectOutcome, "preparing">;
  /** Updated recovery availability. */
  readonly recovery?: RecoveryAvailability;
  /** Safe projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Registered recovery unit identifier. */
  readonly recoveryUnitId?: string;
  /** Terminal completion time. */
  readonly completedAt?: number;
  /** Structured failure summary. */
  readonly error?: {
    /** Stable error code. */
    readonly code: string;
    /** Safe error message. */
    readonly message: string;
  };
}

/** Single owner of effect state. */
export interface EffectLedger {
  /** Allocate a preparing receipt. */
  createReceipt(init: EffectReceiptInit): EffectReceipt;
  /** Apply one legal monotonic receipt transition. */
  transition(
    receiptId: string,
    patch: ReceiptTransition,
  ): EffectReceipt;
  /** Retain one recovery envelope. */
  putEnvelope(envelope: StoredRecoveryEnvelope): void;
  /** Register a scope read model. */
  registerScope(scope: EffectScopeRecord): void;
  /** Register one recovery unit. */
  registerUnit(
    boundaryId: string,
    unit: RegisteredRecoveryUnit,
  ): void;
  /** Update a recovery unit lifecycle. */
  markUnit(unitId: string, status: RecoveryUnitLifecycle): void;
  /** Fold a recovery availability update onto one receipt. */
  markReceiptRecovery(
    receiptId: string,
    recovery: RecoveryAvailability,
  ): void;
  /** Read one receipt. */
  getReceipt(id: string): EffectReceipt | undefined;
  /** Read retained recovery data. */
  getEnvelope(receiptId: string): StoredRecoveryEnvelope | undefined;
  /** Read one registered recovery unit. */
  getUnit(unitId: string): RegisteredRecoveryUnit | undefined;
  /** Read one scope. */
  getScope(id: string): EffectScopeRecord | undefined;
  /** Read ordered units for one boundary. */
  unitsFor(boundaryId: string): readonly RecoveryUnitRecord[];
}

const receipts = new Map<string, EffectReceipt>();
const envelopes = new Map<string, StoredRecoveryEnvelope>();
const scopes = new Map<string, EffectScopeRecord>();
const units = new Map<string, RegisteredRecoveryUnit>();
const unitIdsByBoundary = new Map<string, string[]>();

const terminalOutcomes = new Set<EffectOutcome>([
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
]);

/** Default in-memory ledger used by in-process effects. */
export const effectLedger: EffectLedger = {
  createReceipt(init) {
    if (receipts.has(init.id)) {
      throw new TypeError(`Effect receipt \`${init.id}\` already exists.`);
    }
    const receipt: EffectReceipt = Object.freeze({
      kind: "effect.receipt",
      schemaVersion: 1,
      id: init.id,
      effectId: init.effectId,
      effectVersion: init.effectVersion,
      effectKind: "custom",
      scopeId: init.scopeId,
      boundaryId: init.boundaryId,
      ...(init.runId === undefined ? {} : { runId: init.runId }),
      attemptCount: 1,
      outcome: "preparing",
      recovery: init.recovery,
      startedAt: init.startedAt,
    });
    receipts.set(receipt.id, receipt);
    return receipt;
  },

  transition(receiptId, patch) {
    const current = receipts.get(receiptId);
    if (!current) {
      throw new TypeError(`Effect receipt \`${receiptId}\` was not found.`);
    }
    assertTransition(current.outcome, patch.outcome);
    const next: EffectReceipt = Object.freeze({
      ...current,
      outcome: patch.outcome,
      ...(patch.recovery === undefined
        ? {}
        : { recovery: patch.recovery }),
      ...(patch.resource === undefined
        ? {}
        : { resource: patch.resource }),
      ...(patch.recoveryUnitId === undefined
        ? {}
        : { recoveryUnitId: patch.recoveryUnitId }),
      ...(patch.completedAt === undefined
        ? {}
        : { completedAt: patch.completedAt }),
      ...(patch.error === undefined ? {} : { error: patch.error }),
    });
    receipts.set(receiptId, next);
    return next;
  },

  putEnvelope(envelope) {
    envelopes.set(envelope.receiptId, envelope);
  },

  registerScope(scope) {
    scopes.set(scope.ref.id, scope);
  },

  registerUnit(boundaryId, unit) {
    units.set(unit.id, unit);
    const ids = unitIdsByBoundary.get(boundaryId) ?? [];
    unitIdsByBoundary.set(boundaryId, [...ids, unit.id]);
  },

  markUnit(unitId, status) {
    const current = units.get(unitId);
    if (!current) {
      throw new TypeError(`Recovery unit \`${unitId}\` was not found.`);
    }
    units.set(unitId, Object.freeze({ ...current, status }));
  },

  markReceiptRecovery(receiptId, recovery) {
    const current = receipts.get(receiptId);
    if (!current) {
      throw new TypeError(`Effect receipt \`${receiptId}\` was not found.`);
    }
    receipts.set(
      receiptId,
      Object.freeze({ ...current, recovery }),
    );
  },

  getReceipt(id) {
    return receipts.get(id);
  },

  getEnvelope(receiptId) {
    return envelopes.get(receiptId);
  },

  getUnit(unitId) {
    return units.get(unitId);
  },

  getScope(id) {
    return scopes.get(id);
  },

  unitsFor(boundaryId) {
    return (unitIdsByBoundary.get(boundaryId) ?? [])
      .map((id) => units.get(id))
      .filter(
        (unit): unit is RegisteredRecoveryUnit => unit !== undefined,
      );
  },
};

function assertTransition(
  from: EffectOutcome,
  to: Exclude<EffectOutcome, "preparing">,
): void {
  const legal =
    (from === "preparing" && to === "running") ||
    (from === "preparing" && to === "failed") ||
    (from === "running" && terminalOutcomes.has(to));
  if (!legal) {
    throw new TypeError(
      `Illegal effect receipt transition from \`${from}\` to \`${to}\`.`,
    );
  }
}
