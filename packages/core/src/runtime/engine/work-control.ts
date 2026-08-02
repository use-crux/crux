/** Transaction-owned acceptance for Runtime Work-control commands. */

import type {
  RuntimeWorkControlPort,
  WorkControlCommandInput,
  WorkControlRecord,
  WorkControlReceipt,
} from "../ports/work-control";
import type { RuntimeStoreAdapter, RuntimeStoreTransaction } from "../store";

/** Maximum textual length retained for a Work-control payload digest. */
export const MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH = 256;

/** Stable internal failures raised while accepting Work-control commands. */
export const WORK_CONTROL_ERROR_CODES = Object.freeze({
  WORK_NOT_FOUND: "WORK_CONTROL_WORK_NOT_FOUND",
  COMMAND_CONFLICT: "WORK_CONTROL_COMMAND_CONFLICT",
} as const);

/** Stable internal Work-control acceptance error code. */
export type WorkControlErrorCode =
  (typeof WORK_CONTROL_ERROR_CODES)[keyof typeof WORK_CONTROL_ERROR_CODES];

/** Internal failure with a stable machine-readable Work-control code. */
export class WorkControlAcceptanceError extends Error {
  override readonly name = "WorkControlAcceptanceError";

  constructor(
    readonly code: WorkControlErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Inputs accepted by {@link acceptWorkControlCommand}. */
export type AcceptWorkControlCommandInput = WorkControlCommandInput;

/** Dependencies for atomic Work-control command acceptance. */
export interface AcceptWorkControlCommandDeps {
  /** Runtime store whose transaction owns the acceptance decision. */
  readonly store: RuntimeStoreAdapter;
  /** Clock used only for the initial accepted record. */
  readonly now: () => Date;
}

/**
 * Accept one idempotent steering command for an existing Runtime Work item.
 *
 * Exact replay returns the original receipt without a write. A reused command
 * identity with different pinned inputs fails without changing the record or
 * the owning Work lifecycle.
 */
export async function acceptWorkControlCommand(
  deps: AcceptWorkControlCommandDeps,
  input: AcceptWorkControlCommandInput,
): Promise<WorkControlReceipt> {
  return await deps.store.transact(async (tx) => {
    const workControl = requireWorkControlPort(tx);
    const existing = await workControl.get(input);
    if (existing) return receiptForMatchingRecord(existing, input);

    assertBoundedPayloadHash(input.payloadHash);
    const work = await tx.state.getWork(input.workId, {
      namespace: input.namespace,
    });
    if (!work) {
      throw new WorkControlAcceptanceError(
        WORK_CONTROL_ERROR_CODES.WORK_NOT_FOUND,
        "Owning Runtime Work was not found in this namespace.",
      );
    }

    const acceptedAt = deps.now().toISOString();
    const record = await workControl.create(
      Object.freeze({
        namespace: input.namespace,
        workId: input.workId,
        commandId: input.commandId,
        payloadHash: input.payloadHash,
        acceptedAgentTargetId: input.acceptedAgentTargetId,
        resolvedPlanId: input.resolvedPlanId,
        revision: 1,
        outcome: "accepted" as const,
        createdAt: acceptedAt,
        updatedAt: acceptedAt,
      }),
    );
    return receiptForMatchingRecord(record, input);
  });
}

function requireWorkControlPort(
  tx: RuntimeStoreTransaction,
): RuntimeWorkControlPort {
  if (!tx.workControl) {
    throw new Error("Runtime Work-control storage is unavailable.");
  }
  return tx.workControl;
}

function assertBoundedPayloadHash(payloadHash: string): void {
  if (
    payloadHash.length === 0 ||
    payloadHash.length > MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH
  ) {
    throw new RangeError(
      `Work control payloadHash must contain 1 to ${MAX_WORK_CONTROL_PAYLOAD_HASH_LENGTH} characters.`,
    );
  }
}

function immutableCommandFingerprint(input: WorkControlCommandInput): string {
  return JSON.stringify([
    input.namespace,
    input.workId,
    input.commandId,
    input.payloadHash,
    input.acceptedAgentTargetId,
    input.resolvedPlanId,
  ]);
}

function receiptForMatchingRecord(
  record: WorkControlRecord,
  input: WorkControlCommandInput,
): WorkControlReceipt {
  if (
    immutableCommandFingerprint(record) !== immutableCommandFingerprint(input)
  ) {
    throw new WorkControlAcceptanceError(
      WORK_CONTROL_ERROR_CODES.COMMAND_CONFLICT,
      "Work-control command identity was reused with different immutable inputs.",
    );
  }
  return receiptFor(record);
}

function receiptFor(input: WorkControlReceipt): WorkControlReceipt {
  return Object.freeze({
    namespace: input.namespace,
    workId: input.workId,
    commandId: input.commandId,
    acceptedAgentTargetId: input.acceptedAgentTargetId,
    resolvedPlanId: input.resolvedPlanId,
    revision: input.revision,
    outcome: input.outcome,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  });
}
