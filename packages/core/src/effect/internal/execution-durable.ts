/** Durable preparation bridge for custom Effect execution. @internal @module */

import type {
  Awaitable,
  CapturedEffectRecoveryContext,
  EffectRecoveryContext,
  EffectReceiptRef,
  EffectResource,
} from "../types";
import type { EffectOccurrence } from "./occurrence";
import {
  hasDurableEffectLedger,
  prepareDurableEffectExecution,
} from "./ledger-durable";
import { registerCustomRecoveryUnit } from "./recovery-stack";
import { isOptionalEffectJsonSafe } from "./execution-helpers";

type CustomRecovery<TInput, TOutput> =
  | ((context: EffectRecoveryContext<TInput, TOutput>) => Awaitable<void>)
  | {
      readonly execute: (
        context: CapturedEffectRecoveryContext<TInput, TOutput, unknown>,
      ) => Awaitable<void>;
    };

/** Persist the complete prepared occurrence before entering its executor. */
export async function prepareDurableCustomEffect<TInput, TOutput>(input: {
  readonly boundaryId: string;
  readonly occurrence: EffectOccurrence;
  readonly receipt: EffectReceiptRef;
  readonly effectVersion: number;
  readonly value: TInput;
  readonly captured?: unknown;
  readonly resource?: EffectResource | readonly EffectResource[];
  readonly recover?: CustomRecovery<TInput, TOutput>;
}): Promise<void> {
  if (hasDurableEffectLedger() && input.recover) {
    registerCustomRecoveryUnit({
      boundaryId: input.boundaryId,
      unitId: input.occurrence.recoveryUnitId,
      idempotencyKey: input.occurrence.recoveryIdempotencyKey,
      receipt: input.receipt,
      effectVersion: input.effectVersion,
      input: input.value,
      output: undefined,
      captured: input.captured,
      ...(input.resource === undefined ? {} : { resource: input.resource }),
      durable:
        isOptionalEffectJsonSafe(input.value) &&
        isOptionalEffectJsonSafe(input.captured),
      status: "prepared",
      recover: input.recover,
    });
  }
  await prepareDurableEffectExecution({
    receiptId: input.receipt.id,
    executionIdempotencyKey: input.occurrence.idempotencyKey,
    ...(input.recover
      ? { recoveryUnitId: input.occurrence.recoveryUnitId }
      : {}),
  });
}
