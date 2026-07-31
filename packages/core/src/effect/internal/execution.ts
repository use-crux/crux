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
  EffectScopeRef,
} from "../types";
import { currentScopeStack } from "../../scope/internal";
import { CruxEffectError } from "../errors";
import {
  assertEffectBoundaryOpen,
  createImplicitRootBoundary,
  currentEffectBoundary,
} from "./boundary";
import { isEffectJsonSafe } from "./json-safety";
import { effectLedger } from "./ledger";
import { createEffectOccurrence } from "./occurrence";
import {
  registerEffectStackEntry,
  registerRecoveryUnit,
} from "./recovery-stack";

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
  },
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
    recovery: options?.recover
      ? "unavailable"
      : "irreversible",
    startedAt: Date.now(),
  });
  const ref = receiptRef(receipt.id, definition.id);
  const input = args[0] as TInput;
  let resource: ReturnType<
    NonNullable<EffectOptions<TInput>["resource"]>
  >;
  let captured: unknown;

  try {
    resource = options?.resource?.(input);
  } catch (error) {
    const failure = preparationError(
      "EFFECT_RESOURCE_FAILED",
      `Resource projection failed for effect \`${definition.id}\`.`,
      error,
    );
    effectLedger.transition(receipt.id, {
      outcome: "failed",
      recovery: "unavailable",
      completedAt: Date.now(),
      error: summarizeError(failure),
    });
    if (ownsBoundary) closeImplicitBoundary(boundary);
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
      const failure = preparationError(
        "EFFECT_CAPTURE_FAILED",
        `Recovery capture failed for effect \`${definition.id}\`.`,
        error,
      );
      effectLedger.transition(receipt.id, {
        outcome: "failed",
        recovery: "unavailable",
        ...(resource === undefined ? {} : { resource }),
        completedAt: Date.now(),
        error: summarizeError(failure),
      });
      if (ownsBoundary) closeImplicitBoundary(boundary);
      throw failure;
    }
  }

  effectLedger.transition(receipt.id, {
    outcome: "running",
    ...(resource === undefined ? {} : { resource }),
  });

  try {
    const output = await executor(input, {
      idempotencyKey: occurrence.idempotencyKey,
      receiptId: receipt.id,
      scope: boundary,
    });
    if (options?.recover) {
      const recovery = options.recover;
      registerRecoveryUnit({
        boundaryId: boundary.id,
        unitId: occurrence.recoveryUnitId,
        idempotencyKey: occurrence.recoveryIdempotencyKey,
        receipt: ref,
        ...(resource === undefined ? {} : { resource }),
        envelope: Object.freeze({
          schemaVersion: 1,
          receiptId: receipt.id,
          effectId: definition.id,
          effectVersion: definition.version,
          input,
          output,
          ...(typeof recovery === "function"
            ? {}
            : { captured }),
          createdAt: Date.now(),
          durable:
            isOptionalJsonSafe(input) &&
            isOptionalJsonSafe(output) &&
            isOptionalJsonSafe(captured),
        }),
        execute: async ({
          envelope,
          receipt: recoveryReceipt,
          resource: recoveryResource,
          idempotencyKey,
          options: recoverOptions,
        }) => {
          const baseContext = {
            input: envelope.input as TInput,
            output: envelope.output as TOutput,
            receipt: recoveryReceipt,
            resource: recoveryResource,
            idempotencyKey,
            conflict: recoverOptions?.conflict ?? "fail",
            signal: recoverOptions?.signal,
          };
          if (typeof recovery === "function") {
            await recovery(baseContext);
            return;
          }
          await recovery.execute({
            ...baseContext,
            captured: envelope.captured,
          });
        },
      });
    }
    effectLedger.transition(receipt.id, {
      outcome: "succeeded",
      ...(options?.recover
        ? {
            recovery: "available" as const,
            recoveryUnitId: occurrence.recoveryUnitId,
          }
        : {}),
      completedAt: Date.now(),
    });
    registerEffectStackEntry(boundary.id, receipt.id);
    if (ownsBoundary) closeImplicitBoundary(boundary);
    return Object.freeze({
      output,
      receipt: ref,
    });
  } catch (error) {
    effectLedger.transition(receipt.id, {
      outcome: "failed",
      completedAt: Date.now(),
      error: summarizeError(error),
    });
    if (ownsBoundary) closeImplicitBoundary(boundary);
    throw error;
  }
}

function closeImplicitBoundary(boundary: EffectScopeRef): void {
  effectLedger.registerScope({
    ref: boundary,
    status: "closed",
    unitIds: effectLedger
      .unitsFor(boundary.id)
      .map((unit) => unit.id),
  });
}

function isOptionalJsonSafe(value: unknown): boolean {
  return value === undefined || isEffectJsonSafe(value);
}

function preparationError(
  code: "EFFECT_RESOURCE_FAILED" | "EFFECT_CAPTURE_FAILED",
  message: string,
  cause: unknown,
): CruxEffectError {
  return new CruxEffectError({ code, message, cause });
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
