/**
 * In-memory owner of effect receipt and recovery state.
 *
 * @internal
 * @module
 */

import type {
  EffectOutcome,
  EffectReceipt,
  EffectScopeRecord,
  RecoveryAvailability,
  RecoveryUnitLifecycle,
  RecoveryUnitRecord,
} from "../receipt-types";
import type { EffectResource } from "../types";
import type {
  RecoveryHandlerInvocation,
  RecoveryOperationResult,
  RecoveryStackEntry,
  RegisteredRecoveryUnit,
  StoredRecoveryEnvelope,
} from "./recovery-stack";
import {
  commitLedgerReconciliation,
  type LedgerReconciliation,
  type ReconciliationAudit,
  type ReconciliationLedgerState,
} from "./reconcile";

/** Fields required to allocate a preparing receipt. */
export interface EffectReceiptInit {
  readonly id: string;
  readonly effectId: string;
  readonly effectVersion: number;
  readonly effectKind?: "custom" | "native";
  readonly nativePrimitive?: string;
  readonly scopeId: string;
  readonly boundaryId: string;
  /** Original receipt when this record describes recovery. */
  readonly parentReceiptId?: string;
  /** Recovery unit this record attempts to settle. */
  readonly recoveryUnitId?: string;
  /** Containing run identifier. */
  readonly runId?: string;
  /** Canonical observability span identifier. */
  readonly spanId?: string;
  /** Initial recovery availability. */
  readonly recovery: RecoveryAvailability;
  readonly startedAt: number;
}

/** Monotonic patch applied to an existing receipt. */
export interface ReceiptTransition {
  readonly outcome: Exclude<EffectOutcome, "preparing">;
  readonly recovery?: RecoveryAvailability;
  /** Safe projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  readonly recoveryUnitId?: string;
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
  createReceipt(init: EffectReceiptInit): EffectReceipt;
  transition(receiptId: string, patch: ReceiptTransition): EffectReceipt;
  reconcile(command: LedgerReconciliation): EffectReceipt;
  putEnvelope(envelope: StoredRecoveryEnvelope): void;
  registerScope(scope: EffectScopeRecord): void;
  registerUnit(boundaryId: string, unit: RegisteredRecoveryUnit): void;
  appendStackEntry(boundaryId: string, entry: RecoveryStackEntry): void;
  markUnit(
    unitId: string,
    status: RecoveryUnitLifecycle,
    recoveryOperation?: Promise<RecoveryOperationResult>,
  ): void;
  markReceiptRecovery(receiptId: string, recovery: RecoveryAvailability): EffectReceipt;
  getReceipt(id: string): EffectReceipt | undefined;
  getEnvelope(receiptId: string): StoredRecoveryEnvelope | undefined;
  getUnit(unitId: string): RegisteredRecoveryUnit | undefined;
  getScope(id: string): EffectScopeRecord | undefined;
  receiptsFor(boundaryId: string): readonly EffectReceipt[];
  reconciliationsFor(receiptId: string): readonly ReconciliationAudit[];
  unitsFor(boundaryId: string): readonly RecoveryUnitRecord[];
  stackFor(boundaryId: string): readonly RecoveryStackEntry[];
}

const receipts = new Map<string, EffectReceipt>();
const envelopes = new Map<string, StoredRecoveryEnvelope>();
const scopes = new Map<string, EffectScopeRecord>();
const units = new Map<string, RegisteredRecoveryUnit>();
const unitIdsByBoundary = new Map<string, string[]>();
const stacksByBoundary = new Map<string, RecoveryStackEntry[]>();
const reconciliationAudits = new Map<string, ReconciliationAudit[]>();

const reconciliationState: ReconciliationLedgerState = {
  getReceipt: (id) => receipts.get(id),
  getEnvelope: (receiptId) => envelopes.get(receiptId),
  getUnit: (unitId) => units.get(unitId),
  commit(change) {
    for (const receipt of change.receipts) {
      receipts.set(receipt.id, receipt);
    }
    if (change.envelope) {
      envelopes.set(change.envelope.receiptId, change.envelope);
    }
    if (change.unit) units.set(change.unit.id, change.unit);
    if (change.discardUnit) discardPreparedUnit(change.discardUnit);
    const audits = reconciliationAudits.get(change.audit.receiptId) ?? [];
    reconciliationAudits.set(
      change.audit.receiptId,
      [...audits, change.audit],
    );
  },
};

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
      effectKind: init.effectKind ?? "custom",
      ...(init.nativePrimitive === undefined
        ? {}
        : { nativePrimitive: init.nativePrimitive }),
      scopeId: init.scopeId,
      boundaryId: init.boundaryId,
      ...(init.parentReceiptId === undefined ? {} : { parentReceiptId: init.parentReceiptId }),
      ...(init.runId === undefined ? {} : { runId: init.runId }),
      ...(init.spanId === undefined ? {} : { spanId: init.spanId }),
      attemptCount: 1,
      outcome: "preparing",
      recovery: init.recovery,
      ...(init.recoveryUnitId === undefined ? {} : { recoveryUnitId: init.recoveryUnitId }),
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

  reconcile(command) {
    return commitLedgerReconciliation(command, reconciliationState);
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

  appendStackEntry(boundaryId, entry) {
    const entries = stacksByBoundary.get(boundaryId) ?? [];
    stacksByBoundary.set(boundaryId, [...entries, Object.freeze(entry)]);
  },

  markUnit(unitId, status, recoveryOperation) {
    const current = units.get(unitId);
    if (!current) {
      throw new TypeError(`Recovery unit \`${unitId}\` was not found.`);
    }
    units.set(
      unitId,
      Object.freeze({ ...current, status, recoveryOperation }),
    );
  },

  markReceiptRecovery(receiptId, recovery) {
    const current = receipts.get(receiptId);
    if (!current) {
      throw new TypeError(`Effect receipt \`${receiptId}\` was not found.`);
    }
    const next = Object.freeze({ ...current, recovery });
    receipts.set(receiptId, next);
    return next;
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

  receiptsFor(boundaryId) {
    return [...receipts.values()].filter(
      (receipt) => receipt.boundaryId === boundaryId,
    );
  },

  reconciliationsFor(receiptId) {
    return reconciliationAudits.get(receiptId) ?? [];
  },

  unitsFor(boundaryId) {
    return (unitIdsByBoundary.get(boundaryId) ?? [])
      .map((id) => units.get(id))
      .filter(
        (unit): unit is RegisteredRecoveryUnit => unit !== undefined,
      );
  },

  stackFor(boundaryId) {
    return stacksByBoundary.get(boundaryId) ?? [];
  },
};

function discardPreparedUnit(unit: RegisteredRecoveryUnit): void {
  units.delete(unit.id);
  unitIdsByBoundary.set(
    unit.boundaryId,
    (unitIdsByBoundary.get(unit.boundaryId) ?? []).filter(
      (id) => id !== unit.id,
    ),
  );
  for (const receiptId of unit.receiptIds) {
    envelopes.delete(receiptId);
  }
  const scope = scopes.get(unit.boundaryId);
  if (scope) {
    scopes.set(unit.boundaryId, Object.freeze({
      ...scope,
      unitIds: scope.unitIds.filter((id) => id !== unit.id),
    }));
  }
}

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
