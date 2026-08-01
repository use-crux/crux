/**
 * Append-only registration for custom recovery units.
 *
 * @internal
 * @module
 */

import type {
  Awaitable,
  CapturedEffectRecoveryContext,
  EffectRecoveryContext,
  EffectReceiptRef,
  EffectResource,
  EffectScopeRef,
  RecoverOptions,
  RecoveryUnitResult,
} from "../types";
import type {
  RecoveryUnitLifecycle,
  RecoveryUnitRecord,
} from "../receipt-types";
import { effectLedger } from "./ledger";

/** Settlement shared by callers joining one in-flight recovery. */
export interface RecoveryOperationResult {
  readonly result: RecoveryUnitResult;
  readonly error?: unknown;
}

/** Ephemeral recovery data retained only inside the in-memory ledger. */
export interface StoredRecoveryEnvelope {
  readonly schemaVersion: 1;
  readonly receiptId: string;
  readonly effectId: string;
  readonly effectVersion: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly captured?: unknown;
  readonly createdAt: number;
  readonly durable: boolean;
}

/** Input supplied by the ledger to a registered recovery handler. */
export interface RecoveryHandlerInvocation {
  readonly envelope: StoredRecoveryEnvelope;
  readonly receipt: EffectReceiptRef;
  readonly resource?: EffectResource | readonly EffectResource[];
  readonly idempotencyKey: string;
  readonly options?: RecoverOptions;
}

/** Recovery unit for one custom effect with its in-process handler binding. */
export interface RegisteredEffectRecoveryUnit
  extends RecoveryUnitRecord {
  readonly kind: "effect";
  /** Invoke the exact definition version registered for this unit. */
  readonly execute: (
    invocation: RecoveryHandlerInvocation,
  ) => Promise<void>;
  readonly recoveryOperation?: Promise<RecoveryOperationResult>;
}

/** Recovery unit representing one completed child rollback boundary. */
export interface RegisteredBoundaryRecoveryUnit
  extends RecoveryUnitRecord {
  readonly kind: "boundary";
  /** Child boundary recursively traversed by this unit. */
  readonly scope: EffectScopeRef;
  readonly recoveryOperation?: Promise<RecoveryOperationResult>;
}

/** Recovery unit retained by the in-memory ledger. */
export type RegisteredRecoveryUnit =
  | RegisteredEffectRecoveryUnit
  | RegisteredBoundaryRecoveryUnit;

/** One append-only entry in a boundary's causal recovery stack. */
export type RecoveryStackEntry =
  | { readonly kind: "effect"; readonly receiptId: string }
  | { readonly kind: "boundary"; readonly unitId: string };

/** Input required to activate one single-receipt recovery unit. */
export interface RecoveryUnitRegistration {
  /** Owning boundary identifier. */
  readonly boundaryId: string;
  /** Stable unit identifier. */
  readonly unitId: string;
  /** Stable recovery idempotency key. */
  readonly idempotencyKey: string;
  /** Original receipt reference. */
  readonly receipt: EffectReceiptRef;
  /** Safe projected resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
  /** Retained recovery data. */
  readonly envelope: StoredRecoveryEnvelope;
  /** Bound recovery handler. */
  readonly execute: RegisteredEffectRecoveryUnit["execute"];
  /** Initial lifecycle for a known or ambiguous execution outcome. */
  readonly status?: "prepared" | "active";
}

/** Retain recovery data and activate a single-receipt unit. */
export function registerRecoveryUnit(
  registration: RecoveryUnitRegistration,
): void {
  effectLedger.putEnvelope(registration.envelope);
  effectLedger.registerUnit(
    registration.boundaryId,
    Object.freeze({
      kind: "effect",
      id: registration.unitId,
      boundaryId: registration.boundaryId,
      receiptIds: [registration.receipt.id],
      effectIds: [registration.receipt.effectId],
      status: registration.status ?? "active",
      idempotencyKey: registration.idempotencyKey,
      execute: registration.execute,
    }),
  );
}

type CustomRecovery<TInput, TOutput> =
  | ((context: EffectRecoveryContext<TInput, TOutput>) => Awaitable<void>)
  | {
      readonly execute: (
        context: CapturedEffectRecoveryContext<
          TInput,
          TOutput,
          unknown
        >,
      ) => Awaitable<void>;
    };

/** Bind retained occurrence state to one custom recovery handler. */
export function registerCustomRecoveryUnit<TInput, TOutput>(
  registration: {
    readonly boundaryId: string;
    readonly unitId: string;
    readonly idempotencyKey: string;
    readonly receipt: EffectReceiptRef;
    readonly effectVersion: number;
    readonly input: TInput;
    readonly output: TOutput | undefined;
    readonly captured?: unknown;
    readonly resource?: EffectResource | readonly EffectResource[];
    readonly durable: boolean;
    readonly status?: "prepared" | "active";
    readonly recover: CustomRecovery<TInput, TOutput>;
  },
): void {
  const recovery = registration.recover;
  registerRecoveryUnit({
    boundaryId: registration.boundaryId,
    unitId: registration.unitId,
    idempotencyKey: registration.idempotencyKey,
    receipt: registration.receipt,
    ...(registration.resource === undefined
      ? {}
      : { resource: registration.resource }),
    envelope: Object.freeze({
      schemaVersion: 1,
      receiptId: registration.receipt.id,
      effectId: registration.receipt.effectId,
      effectVersion: registration.effectVersion,
      input: registration.input,
      output: registration.output,
      ...(typeof recovery === "function"
        ? {}
        : { captured: registration.captured }),
      createdAt: Date.now(),
      durable: registration.durable,
    }),
    status: registration.status,
    execute: async ({
      envelope,
      receipt,
      resource,
      idempotencyKey,
      options,
    }) => {
      const context = {
        input: envelope.input as TInput,
        output: envelope.output as TOutput,
        receipt,
        resource,
        idempotencyKey,
        conflict: options?.conflict ?? "fail",
        signal: options?.signal,
      };
      if (typeof recovery === "function") {
        await recovery(context);
        return;
      }
      await recovery.execute({
        ...context,
        captured: envelope.captured,
      });
    },
  });
}

/** Project one registered unit to its public settlement. */
export function createRecoveryUnitResult(
  unit: {
    readonly id: string;
    readonly effectIds: readonly string[];
  },
  resource: RecoveryUnitResult["resource"],
  status: RecoveryUnitResult["status"],
): RecoveryUnitResult {
  return Object.freeze({
    unitId: unit.id,
    effectIds: unit.effectIds,
    ...(resource === undefined ? {} : { resource }),
    status,
  });
}

/** Append one settled effect occurrence to its boundary's causal stack. */
export function registerEffectStackEntry(
  boundaryId: string,
  receiptId: string,
): void {
  effectLedger.appendStackEntry(boundaryId, {
    kind: "effect",
    receiptId,
  });
}

/** Register one completed child boundary as a unit in its parent plan. */
export function registerNestedBoundaryUnit(
  parentId: string,
  scope: EffectScopeRef,
  status: RecoveryUnitLifecycle,
): void {
  if (effectLedger.stackFor(scope.id).length === 0) return;
  const childUnits = effectLedger.unitsFor(scope.id);
  const childReceipts = effectLedger.receiptsFor(scope.id);
  const effectIds = [
    ...new Set([
      ...childReceipts.map((receipt) => receipt.effectId),
      ...childUnits.flatMap((unit) => unit.effectIds),
    ]),
  ];
  const receiptIds = [
    ...new Set([
      ...childReceipts.map((receipt) => receipt.id),
      ...childUnits.flatMap((unit) => unit.receiptIds),
    ]),
  ];
  const unitId = `effect-boundary-unit:${scope.id}`;
  effectLedger.registerUnit(
    parentId,
    Object.freeze({
      kind: "boundary",
      id: unitId,
      boundaryId: parentId,
      receiptIds,
      effectIds,
      status,
      idempotencyKey: `effect-boundary-recovery:${scope.id}`,
      scope,
    }),
  );
  effectLedger.appendStackEntry(parentId, {
    kind: "boundary",
    unitId,
  });
}
