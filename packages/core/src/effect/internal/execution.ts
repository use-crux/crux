/**
 * Lifecycle for one custom effect occurrence.
 *
 * @internal
 * @module
 */

import type {
  Awaitable,
  CapturedEffectRecoveryContext,
  EffectCaptureContext,
  EffectExecutionResult,
  EffectExecutor,
  EffectOptions,
  EffectRecoveryContext,
} from "../types";
import { currentScopeStack } from "../../scope/internal";
import {
  CruxEffectError,
  EffectOutcomeUnknownError,
  summarizeEffectError,
} from "../errors";
import {
  assertEffectBoundaryOpen,
  currentEffectBoundary,
} from "./boundary";
import {
  closeImplicitRootBoundary,
  createImplicitRootBoundary,
} from "./boundary-identity";
import {
  linkDurableEffectReceiptEvidence,
  linkDurableEffectReceiptRetryCount,
  persistDurableReceiptTransition,
  settleDurableEffectExecution,
} from "./ledger-durable";
import { effectLedger } from "./ledger";
import { recordEffectReceiptSettlement } from "./evidence";
import { observeEffectRun } from "./observability";
import {
  createEffectOccurrence,
  createEffectReceiptRef,
} from "./occurrence";
import {
  registerEffectStackEntry,
  registerCustomRecoveryUnit,
} from "./recovery-stack";
import { prepareDurableCustomEffect } from "./execution-durable";
import {
  effectPreparationError,
  isOptionalEffectJsonSafe,
} from "./execution-helpers";
import {
  currentEffectJournalContext,
  registerEffectJournalLinker,
  registerEffectJournalRetryLinker,
} from "./journal-context";

type CapturedRecovery<TInput, TOutput> = {
  readonly capture: (context: EffectCaptureContext<TInput>) => Awaitable<unknown>;
  readonly execute: (context: CapturedEffectRecoveryContext<
    TInput,
    TOutput,
    unknown
  >) => Awaitable<void>;
};

/** Runtime configuration retained from an effect definition. */
export interface EffectRuntimeOptions<TInput, TOutput>
  extends EffectOptions<TInput> {
  /** Optional single-receipt recovery handler. */
  readonly recover?:
    | ((context: EffectRecoveryContext<TInput, TOutput>) => Awaitable<void>)
    | CapturedRecovery<TInput, TOutput>;
}

/** Execute one effect occurrence and settle its receipt. */
export async function executeEffectOccurrence<TInput, TOutput>(
  definition: {
    readonly id: string;
    readonly version: number;
  } & object,
  executor: EffectExecutor<TInput, TOutput>,
  args: readonly [] | readonly [input: TInput],
  options?: EffectRuntimeOptions<TInput, TOutput>,
): Promise<EffectExecutionResult<TOutput>> {
  const explicitBoundary = currentEffectBoundary();
  if (explicitBoundary) {
    assertEffectBoundaryOpen(explicitBoundary, definition.id);
  }
  if (
    explicitBoundary?.recovery === "required" &&
    !options?.recover
  ) {
    throw new CruxEffectError({
      code: "EFFECT_RECOVERY_REQUIRED",
      message:
        `Effect \`${definition.id}\` cannot run in required-recovery ` +
        `boundary \`${explicitBoundary.ref.id}\`. Define recovery, move ` +
        "the effect out of this boundary, or use " +
        "`{ recovery: 'best-effort' }`.",
    });
  }
  const boundary =
    explicitBoundary?.ref ?? createImplicitRootBoundary();
  const ownsBoundary = explicitBoundary === undefined;
  const ancestry = currentScopeStack();
  const groupingScope = ancestry.find(
    (scope) => scope.kind !== "effect-boundary",
  );
  const scopePath = [...ancestry]
    .reverse()
    .map((scope) => `${scope.kind}[${scope.id}]`)
    .join("/");
  const occurrence = createEffectOccurrence(
    boundary, scopePath || "root", definition.id, definition.version,
  );
  const observation = observeEffectRun({
    effectId: definition.id,
    effectVersion: definition.version,
    receiptId: occurrence.receiptId,
    scopeId: groupingScope?.id ?? boundary.id,
    boundaryId: boundary.id,
    recovery: options?.recover ? "unavailable" : "irreversible",
  });
  return observation.run(async () => {
  const journal = currentEffectJournalContext();
  if (ownsBoundary) {
    effectLedger.registerScope({
      ref: boundary,
      status: "open",
      unitIds: [],
    });
  }
  const receipt = effectLedger.createReceipt({
    id: occurrence.receiptId,
    effectId: definition.id,
    effectVersion: definition.version,
    scopeId: groupingScope?.id ?? boundary.id,
    boundaryId: boundary.id,
    runId: boundary.runId,
    ...(observation.spanId === undefined
      ? {}
      : { spanId: observation.spanId }),
    ...(journal ?? {}),
    recovery: options?.recover
      ? "unavailable"
      : "irreversible",
    startedAt: Date.now(),
  });
  const ref = createEffectReceiptRef(receipt.id, definition.id);
  const input = args[0] as TInput;
  let resource: ReturnType<
    NonNullable<EffectOptions<TInput>["resource"]>
  >;
  let captured: unknown;

  try {
    resource = options?.resource?.(input);
  } catch (error) {
    const failure = effectPreparationError(
      "EFFECT_RESOURCE_FAILED",
      `Resource projection failed for effect \`${definition.id}\`.`,
      error,
    );
    const settledReceipt = effectLedger.transition(receipt.id, {
      outcome: "failed",
      recovery: "unavailable",
      completedAt: Date.now(),
      error: summarizeEffectError(failure),
    });
    recordEffectReceiptSettlement(settledReceipt);
    observation.settle(settledReceipt);
    if (ownsBoundary) closeImplicitRootBoundary(boundary);
    throw failure;
  }

  if (options?.recover && typeof options.recover !== "function") {
    try {
      captured = await options.recover.capture({
        input,
        receipt: ref,
        signal: undefined,
      });
    } catch (error) {
      const failure = effectPreparationError(
        "EFFECT_CAPTURE_FAILED",
        `Recovery capture failed for effect \`${definition.id}\`.`,
        error,
      );
      const settledReceipt = effectLedger.transition(receipt.id, {
        outcome: "failed",
        recovery: "unavailable",
        ...(resource === undefined ? {} : { resource }),
        completedAt: Date.now(),
        error: summarizeEffectError(failure),
      });
      recordEffectReceiptSettlement(settledReceipt);
      observation.settle(settledReceipt);
      if (ownsBoundary) closeImplicitRootBoundary(boundary);
      throw failure;
    }
  }

  await prepareDurableCustomEffect<TInput, TOutput>({
    boundaryId: boundary.id,
    occurrence,
    receipt: ref,
    effectVersion: definition.version,
    value: input,
    captured,
    ...(resource === undefined ? {} : { resource }),
    ...(options?.recover ? { recover: options.recover } : {}),
  });
  registerEffectJournalRetryLinker(async (requestRetryCount) => {
    await linkDurableEffectReceiptRetryCount(
      receipt.id,
      requestRetryCount,
    );
    effectLedger.linkRequestRetryCount(receipt.id, requestRetryCount);
  });

  effectLedger.transition(receipt.id, {
    outcome: "running",
    ...(resource === undefined ? {} : { resource }),
  });

  try {
    const execution = Promise.resolve(executor(input, {
      idempotencyKey: occurrence.idempotencyKey,
      receiptId: receipt.id,
      scope: boundary,
    }));
    await persistDurableReceiptTransition(receipt.id);
    const output = await execution;
    if (options?.recover) {
      registerCustomRecoveryUnit({
        boundaryId: boundary.id,
        unitId: occurrence.recoveryUnitId,
        idempotencyKey: occurrence.recoveryIdempotencyKey,
        receipt: ref,
        effectVersion: definition.version,
        input,
        output,
        captured,
        ...(resource === undefined ? {} : { resource }),
        durable:
          isOptionalEffectJsonSafe(input) &&
          isOptionalEffectJsonSafe(output) &&
          isOptionalEffectJsonSafe(captured),
        recover: options.recover,
      });
    }
    const settledReceipt = effectLedger.transition(receipt.id, {
      outcome: "succeeded",
      ...(options?.recover
        ? {
            recovery: "available" as const,
            recoveryUnitId: occurrence.recoveryUnitId,
          }
        : {}),
      completedAt: Date.now(),
    });
    recordEffectReceiptSettlement(settledReceipt);
    observation.settle(settledReceipt);
    registerEffectStackEntry(boundary.id, receipt.id);
    await settleDurableEffectExecution(receipt.id);
    registerEffectJournalLinker(async (toolOutcomeRef) => {
      await linkDurableEffectReceiptEvidence(receipt.id, toolOutcomeRef);
      effectLedger.linkToolOutcome(receipt.id, toolOutcomeRef);
    });
    if (ownsBoundary) closeImplicitRootBoundary(boundary);
    return Object.freeze({
      output,
      receipt: ref,
    });
  } catch (error) {
    if (error instanceof EffectOutcomeUnknownError) {
      if (options?.recover) {
        registerCustomRecoveryUnit({
          boundaryId: boundary.id,
          unitId: occurrence.recoveryUnitId,
          idempotencyKey: occurrence.recoveryIdempotencyKey,
          receipt: ref,
          effectVersion: definition.version,
          input,
          output: undefined,
          captured,
          ...(resource === undefined ? {} : { resource }),
          durable:
            isOptionalEffectJsonSafe(input) &&
            isOptionalEffectJsonSafe(captured),
          status: "prepared",
          recover: options.recover,
        });
      }
      const settledReceipt = effectLedger.transition(receipt.id, {
        outcome: "unknown",
        recovery: "ambiguous",
        ...(options?.recover
          ? { recoveryUnitId: occurrence.recoveryUnitId }
          : {}),
        completedAt: Date.now(),
        error: summarizeEffectError(error),
      });
      recordEffectReceiptSettlement(settledReceipt);
      observation.settle(settledReceipt);
      registerEffectStackEntry(boundary.id, receipt.id);
      if (ownsBoundary) closeImplicitRootBoundary(boundary);
      throw error;
    }
    const settledReceipt = effectLedger.transition(receipt.id, {
      outcome: "failed",
      completedAt: Date.now(),
      error: summarizeEffectError(error),
    });
    recordEffectReceiptSettlement(settledReceipt);
    observation.settle(settledReceipt);
    if (ownsBoundary) closeImplicitRootBoundary(boundary);
    throw error;
  }
  });
}
