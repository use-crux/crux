/**
 * Lifecycle for one custom effect occurrence.
 *
 * @internal
 * @module
 */

import type {
  EffectExecutionResult,
  EffectExecutor,
  EffectScopeRef,
} from "../types";
import { createImplicitRootBoundary } from "./boundary";
import { effectLedger } from "./ledger";
import { createEffectOccurrence } from "./occurrence";

/** Execute one effect occurrence and settle its receipt. */
export async function executeEffectOccurrence<TInput, TOutput>(
  definition: {
    readonly id: string;
    readonly version: number;
    readonly recoverable: boolean;
  },
  executor: EffectExecutor<TInput, TOutput>,
  args: readonly [] | readonly [input: TInput],
): Promise<EffectExecutionResult<TOutput>> {
  const boundary = createImplicitRootBoundary();
  const occurrence = createEffectOccurrence(
    boundary,
    definition.id,
    definition.version,
  );
  effectLedger.registerScope({
    ref: boundary,
    status: "open",
    unitIds: [],
  });
  const receipt = effectLedger.createReceipt({
    id: occurrence.receiptId,
    effectId: definition.id,
    effectVersion: definition.version,
    scopeId: boundary.id,
    boundaryId: boundary.id,
    runId: boundary.runId,
    recovery: definition.recoverable
      ? "unavailable"
      : "irreversible",
    startedAt: Date.now(),
  });
  effectLedger.transition(receipt.id, { outcome: "running" });

  try {
    const output = await executor(args[0] as TInput, {
      idempotencyKey: occurrence.idempotencyKey,
      receiptId: receipt.id,
      scope: boundary,
    });
    effectLedger.transition(receipt.id, {
      outcome: "succeeded",
      completedAt: Date.now(),
    });
    closeImplicitBoundary(boundary);
    return Object.freeze({
      output,
      receipt: receiptRef(receipt.id, definition.id),
    });
  } catch (error) {
    effectLedger.transition(receipt.id, {
      outcome: "failed",
      completedAt: Date.now(),
      error: summarizeError(error),
    });
    closeImplicitBoundary(boundary);
    throw error;
  }
}

function closeImplicitBoundary(boundary: EffectScopeRef): void {
  effectLedger.registerScope({
    ref: boundary,
    status: "closed",
    unitIds: [],
  });
}

function receiptRef(id: string, effectId: string) {
  return Object.freeze({
    kind: "effect.receipt" as const,
    id,
    effectId,
  });
}

function summarizeError(error: unknown): {
  readonly code: string;
  readonly message: string;
} {
  if (error instanceof Error) {
    return {
      code: stringCode(error) ?? error.name,
      message: error.message,
    };
  }
  return {
    code: "UnknownError",
    message: String(error),
  };
}

function stringCode(error: Error): string | undefined {
  const value = (error as Error & { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}
