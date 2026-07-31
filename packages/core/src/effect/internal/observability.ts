/**
 * Read-only observability projection for custom effect receipts.
 *
 * @internal
 * @module
 */

import {
  effectDefinitionRef,
  observe,
  type CruxEffectReceiptSummary,
  type CruxEffectResourceSummary,
  type CruxEffectRunAttributes,
  type CruxSpanId,
  type OpenObservedSpan,
} from "../../observability";
import type { EffectReceipt, RecoveryAvailability } from "../receipt-types";
import type { EffectResource } from "../types";

interface EffectObservationInput {
  readonly effectId: string;
  readonly effectVersion: number;
  readonly receiptId: string;
  readonly scopeId: string;
  readonly boundaryId: string;
  readonly parentReceiptId?: string;
  readonly originalSpanId?: string;
  readonly recovery: RecoveryAvailability;
}

/** One isolated `effect.run` projection around application work. */
export interface EffectObservation {
  readonly spanId?: CruxSpanId;
  run<T>(fn: () => T | Promise<T>): Promise<T>;
  settle(receipt: EffectReceipt): void;
}

/** Open an `effect.run` span without allowing telemetry to alter behavior. */
export function observeEffectRun(
  input: EffectObservationInput,
): EffectObservation {
  try {
    const attributes = startAttributes(input);
    const span = observe.openSpan({
      name: input.parentReceiptId
        ? `${input.effectId} recovery`
        : input.effectId,
      primitive: "effect.run",
      attributes,
      definitionRefs: [
        effectDefinitionRef(input.effectId, input.effectVersion),
      ],
    });
    let terminal: EffectReceipt | undefined;

    return {
      spanId: span.spanId,
      async run<T>(fn: () => T | Promise<T>): Promise<T> {
        try {
          const result = await span.withContext(fn);
          endSpan(span.end, terminal);
          return result;
        } catch (error) {
          try {
            span.error(error, terminalAttributes(terminal));
          } catch {}
          throw error;
        }
      },
      settle(receipt) {
        terminal = receipt;
        try {
          span.withContext(() => {
            observe.artifact({
              kind: "effect.receipt",
              contentType: "application/json",
              encoding: "json",
              preview: receiptSummary(receipt),
            });
            if (input.originalSpanId) {
              observe.edge({
                edgeType: "recovery.of",
                from: { kind: "span", id: span.spanId },
                to: {
                  kind: "span",
                  id: input.originalSpanId as CruxSpanId,
                },
              });
            }
          });
        } catch {}
      },
    };
  } catch {
    return {
      async run<T>(fn: () => T | Promise<T>): Promise<T> {
        return fn();
      },
      settle() {},
    };
  }
}

/** Open the recovery attempt span linked to an original effect receipt. */
export function observeEffectRecoveryRun(
  original: EffectReceipt,
  attemptId: string,
): EffectObservation {
  return observeEffectRun({
    effectId: original.effectId,
    effectVersion: original.effectVersion,
    receiptId: attemptId,
    scopeId: original.scopeId,
    boundaryId: original.boundaryId,
    parentReceiptId: original.id,
    ...(original.spanId === undefined
      ? {}
      : { originalSpanId: original.spanId }),
    recovery: "unavailable",
  });
}

/** Add receipt facets and an artifact to an existing native operation span. */
export function observeNativeEffectReceipt(
  span: OpenObservedSpan,
  receipt: EffectReceipt,
): void {
  try {
    span.setAttributes({
      "crux.effect.id": receipt.effectId,
      "crux.effect.version": receipt.effectVersion,
      "crux.effect.receipt.id": receipt.id,
      "crux.effect.scope.id": receipt.scopeId,
      "crux.effect.boundary.id": receipt.boundaryId,
      "crux.effect.outcome": receipt.outcome,
      "crux.effect.recovery": receipt.recovery,
    } satisfies CruxEffectRunAttributes);
    span.withContext(() => {
      observe.artifact({
        kind: "effect.receipt",
        contentType: "application/json",
        encoding: "json",
        preview: receiptSummary(receipt),
      });
    });
  } catch {}
}

function startAttributes(
  input: EffectObservationInput,
): CruxEffectRunAttributes {
  return {
    "crux.effect.id": input.effectId,
    "crux.effect.version": input.effectVersion,
    "crux.effect.receipt.id": input.receiptId,
    "crux.effect.scope.id": input.scopeId,
    "crux.effect.boundary.id": input.boundaryId,
    ...(input.parentReceiptId === undefined
      ? {}
      : {
          "crux.effect.parent_receipt.id": input.parentReceiptId,
        }),
    "crux.effect.outcome": "preparing",
    "crux.effect.recovery": input.recovery,
  };
}

function terminalAttributes(
  receipt: EffectReceipt | undefined,
): Record<string, unknown> | undefined {
  if (!receipt) return undefined;
  return {
    "crux.effect.outcome": receipt.outcome,
    "crux.effect.recovery": receipt.recovery,
  };
}

function endSpan(
  end: (options?: {
    readonly status?: "ok" | "error" | "cancelled";
    readonly attributes?: Record<string, unknown>;
  }) => void,
  receipt: EffectReceipt | undefined,
): void {
  try {
    end({
      status:
        receipt?.outcome === "cancelled"
          ? "cancelled"
          : receipt?.outcome === "succeeded"
            ? "ok"
            : "error",
      ...(receipt ? { attributes: terminalAttributes(receipt) } : {}),
    });
  } catch {}
}

function receiptSummary(receipt: EffectReceipt): CruxEffectReceiptSummary {
  return {
    kind: "effect.receipt",
    receiptId: receipt.id,
    effectId: receipt.effectId,
    effectVersion: receipt.effectVersion,
    scopeId: receipt.scopeId,
    boundaryId: receipt.boundaryId,
    ...(receipt.parentReceiptId === undefined
      ? {}
      : { parentReceiptId: receipt.parentReceiptId }),
    outcome: receipt.outcome as CruxEffectReceiptSummary["outcome"],
    recovery: receipt.recovery,
    ...(receipt.resource === undefined
      ? {}
      : { resource: resourceSummary(receipt.resource) }),
  };
}

function resourceSummary(
  resource: EffectResource | readonly EffectResource[],
): CruxEffectResourceSummary | readonly CruxEffectResourceSummary[] {
  if (Array.isArray(resource)) {
    return resource.map(singleResourceSummary);
  }
  return singleResourceSummary(resource as EffectResource);
}

function singleResourceSummary(
  item: EffectResource,
): CruxEffectResourceSummary {
  return {
    type: item.type,
    ...(item.id === undefined ? {} : { id: item.id }),
    ...(item.namespace === undefined ? {} : { namespace: item.namespace }),
    ...(item.attributes === undefined
      ? {}
      : { attributes: { ...item.attributes } }),
  };
}
