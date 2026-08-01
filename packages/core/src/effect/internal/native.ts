/**
 * Internal audit-first contract for native Crux effects.
 *
 * @internal
 * @module
 */

import { currentScopeStack } from "../../scope/internal";
import type {
  CruxPrimitiveName,
  OpenObservedSpan,
} from "../../observability";
import {
  CruxEffectError,
  EffectOutcomeUnknownError,
  summarizeEffectError,
} from "../errors";
import type {
  Awaitable,
  EffectExecutionResult,
  EffectReceiptRef,
  EffectResource,
  EffectScopeRef,
} from "../types";
import {
  assertEffectBoundaryOpen,
  currentEffectBoundary,
  trackEffectBoundaryOperation,
  type EffectBoundaryState,
} from "./boundary";
import {
  closeImplicitRootBoundary,
  createImplicitRootBoundary,
} from "./boundary-identity";
import { recordEffectReceiptSettlement } from "./evidence";
import { effectLedger } from "./ledger";
import { observeNativeEffectReceipt } from "./observability";
import {
  createEffectOccurrence,
  createEffectReceiptRef,
} from "./occurrence";
import { registerEffectStackEntry } from "./recovery-stack";

/** Audit capability declared by a native effect domain. */
export type NativeEffectRecoveryAvailability =
  | "unavailable"
  | "irreversible";

/** Provider-owned description of one native domain mutation. */
export interface NativeEffectDescription {
  /** Stable effect identity owned by the native domain. */
  readonly effectId: string;
  /** Effect contract version. Defaults to `1`. */
  readonly effectVersion?: number;
  /** Canonical native primitive that owns the operation span. */
  readonly nativePrimitive: CruxPrimitiveName;
  /** Honest audit-first recovery capability. */
  readonly recovery: NativeEffectRecoveryAvailability;
  /** Privacy-safe domain resource identity. */
  readonly resource?: EffectResource | readonly EffectResource[];
}

/** Context reserved for provider-owned native recovery execution. */
export interface NativeRecoveryContext {
  /** Original native effect receipt. */
  readonly receipt: EffectReceiptRef;
  /** Owning rollback boundary. */
  readonly boundary: EffectScopeRef;
  /** Stable provider recovery idempotency key. */
  readonly idempotencyKey: string;
  /** Conflict policy selected by the recovery caller. */
  readonly conflict: "fail" | "force";
  /** Optional recovery cancellation signal. */
  readonly signal?: AbortSignal;
}

/** Explicit first-party contract implemented by one native mutation domain. */
export interface NativeEffectProvider<TOperation, TRecoveryRef> {
  /** Describe the stable identity and current capability of an operation. */
  describe(operation: TOperation): NativeEffectDescription;
  /** Optionally refine the safe resource summary from the settled output. */
  resourceForOutput?(
    operation: TOperation,
    output: unknown,
  ): EffectResource | readonly EffectResource[] | undefined;
  /** Prepare a future provider-owned recovery reference. */
  prepareRecovery?(
    operation: TOperation,
    boundary: EffectScopeRef,
  ): Promise<TRecoveryRef | undefined>;
  /** Execute future provider-owned recovery. */
  recover(
    reference: TRecoveryRef,
    context: NativeRecoveryContext,
  ): Promise<void>;
}

/**
 * Run one native mutation while contributing an audit-first receipt.
 *
 * The native operation keeps its own span and primitive. This helper only
 * adds Effect facets and a receipt artifact; it never opens `effect.run`.
 * Recovery hooks remain deliberately uncalled until a native domain ships
 * its recovery implementation.
 *
 * @param provider - Explicit first-party native effect provider.
 * @param operation - Provider-owned operation description input.
 * @param span - Existing native operation span to annotate.
 * @param execute - Native mutation to execute once.
 * @returns The native mutation output and immutable receipt reference.
 */
export function runNativeEffect<TOperation, TRecoveryRef, TOutput>(
  provider: NativeEffectProvider<TOperation, TRecoveryRef>,
  operation: TOperation,
  span: OpenObservedSpan,
  execute: () => Awaitable<TOutput>,
): Promise<EffectExecutionResult<TOutput>> {
  const boundary = currentEffectBoundary();
  return trackEffectBoundaryOperation(
    runNativeEffectOccurrence(
      provider,
      operation,
      span,
      execute,
      boundary,
    ),
    boundary,
  );
}

async function runNativeEffectOccurrence<
  TOperation,
  TRecoveryRef,
  TOutput,
>(
  provider: NativeEffectProvider<TOperation, TRecoveryRef>,
  operation: TOperation,
  span: OpenObservedSpan,
  execute: () => Awaitable<TOutput>,
  explicitBoundary: EffectBoundaryState | undefined,
): Promise<EffectExecutionResult<TOutput>> {
  const description = provider.describe(operation);
  if (explicitBoundary) {
    assertEffectBoundaryOpen(explicitBoundary, description.effectId);
  }
  if (explicitBoundary?.recovery === "required") {
    throw new CruxEffectError({
      code: "EFFECT_RECOVERY_REQUIRED",
      message:
        `Effect \`${description.effectId}\` cannot run in required-recovery ` +
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
  const effectVersion = description.effectVersion ?? 1;
  const occurrence = createEffectOccurrence(
    boundary,
    scopePath || "root",
    description.effectId,
    effectVersion,
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
    effectId: description.effectId,
    effectVersion,
    effectKind: "native",
    nativePrimitive: description.nativePrimitive,
    scopeId: groupingScope?.id ?? boundary.id,
    boundaryId: boundary.id,
    runId: boundary.runId,
    spanId: span.spanId,
    recovery: description.recovery,
    startedAt: Date.now(),
  });
  const ref = createEffectReceiptRef(receipt.id, description.effectId);
  effectLedger.transition(receipt.id, {
    outcome: "running",
    ...(description.resource === undefined
      ? {}
      : { resource: description.resource }),
  });

  try {
    const output = await span.withContext(async () => execute());
    const resource =
      safeResourceForOutput(provider, operation, output) ??
      description.resource;
    const settled = effectLedger.transition(receipt.id, {
      outcome: "succeeded",
      completedAt: Date.now(),
      ...(resource === undefined ? {} : { resource }),
    });
    settleNativeReceipt(settled, span, true);
    if (ownsBoundary) closeImplicitRootBoundary(boundary);
    return Object.freeze({ output, receipt: ref });
  } catch (error) {
    const unknown = error instanceof EffectOutcomeUnknownError;
    const settled = effectLedger.transition(receipt.id, {
      outcome: unknown ? "unknown" : "failed",
      completedAt: Date.now(),
      error: summarizeEffectError(error),
    });
    settleNativeReceipt(settled, span, unknown);
    if (ownsBoundary) closeImplicitRootBoundary(boundary);
    throw error;
  }
}

function safeResourceForOutput<TOperation, TRecoveryRef>(
  provider: NativeEffectProvider<TOperation, TRecoveryRef>,
  operation: TOperation,
  output: unknown,
): EffectResource | readonly EffectResource[] | undefined {
  try {
    return provider.resourceForOutput?.(operation, output);
  } catch {
    return undefined;
  }
}

function settleNativeReceipt(
  receipt: Parameters<typeof recordEffectReceiptSettlement>[0],
  span: OpenObservedSpan,
  register: boolean,
): void {
  recordEffectReceiptSettlement(receipt);
  observeNativeEffectReceipt(span, receipt);
  if (register) {
    registerEffectStackEntry(receipt.boundaryId, receipt.id);
  }
}
