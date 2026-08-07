/** Request-journal linkage shared by tool execution and Effects. @internal */

import type { EvidenceArtifactRef } from "../../evidence/subjects";
import type { RequestReceipt } from "../../request/receipt/receipt";
import { sealedRequestPlanRef } from "../../request/receipt/receipt";
import {
  createScopeFacetSlot,
  currentScopeFacet,
  runWithScopeFacet,
} from "../../scope/internal";

/** Immutable request facts copied onto a receipt created by the current tool. */
export interface EffectJournalContext {
  readonly requestId: string;
  readonly requestPlanRef?: EvidenceArtifactRef;
  readonly requestRetryCount: number;
  readonly toolCallId: string;
}

interface ActiveEffectJournalContext extends EffectJournalContext {
  readonly request: RequestReceipt;
  readonly linkers: EffectJournalLinker[];
  readonly retryLinkers: EffectJournalRetryLinker[];
}

/** Deferred receipt linker retained until canonical tool output is observed. */
export type EffectJournalLinker = (ref: EvidenceArtifactRef) => Promise<void>;

/** Deferred retry linker refreshed after an SDK step publishes final facts. */
export type EffectJournalRetryLinker = (retryCount: number) => Promise<void>;

const effectJournalContextSlot =
  createScopeFacetSlot<ActiveEffectJournalContext>("effect.request-journal");
const retryLinkersByRequest = new WeakMap<
  RequestReceipt,
  EffectJournalRetryLinker[]
>();

/** Run a tool inside its sealed request-journal context when one exists. */
export async function runWithEffectJournalContext<R>(
  receipt: RequestReceipt | undefined,
  toolCallId: string,
  run: () => R | PromiseLike<R>,
  retain?: (linkers: readonly EffectJournalLinker[]) => void,
): Promise<Awaited<R>> {
  if (!receipt) return await run();
  const inspection = await receipt.inspect();
  const planRef = sealedRequestPlanRef(receipt);
  const context: ActiveEffectJournalContext = {
    request: receipt,
    requestId: receipt.id,
    ...(planRef ? { requestPlanRef: planRef } : {}),
    requestRetryCount: inspection.retryCount,
    toolCallId,
    linkers: [],
    retryLinkers: [],
  };
  try {
    return await runWithScopeFacet(
      effectJournalContextSlot,
      context,
      async () => await run(),
    );
  } finally {
    if (context.linkers.length > 0) retain?.([...context.linkers]);
    if (context.retryLinkers.length > 0) {
      const existing = retryLinkersByRequest.get(receipt) ?? [];
      retryLinkersByRequest.set(receipt, [
        ...existing,
        ...context.retryLinkers,
      ]);
    }
  }
}

/** Return immutable linkage for an Effect receipt created in the current tool. */
export function currentEffectJournalContext():
  | EffectJournalContext
  | undefined {
  const context = currentScopeFacet(effectJournalContextSlot);
  if (!context) return undefined;
  return Object.freeze({
    requestId: context.requestId,
    ...(context.requestPlanRef
      ? { requestPlanRef: context.requestPlanRef }
      : {}),
    requestRetryCount: context.requestRetryCount,
    toolCallId: context.toolCallId,
  });
}

/** Register a completed receipt for canonical tool-outcome linkage. */
export function registerEffectJournalLinker(linker: EffectJournalLinker): void {
  currentScopeFacet(effectJournalContextSlot)?.linkers.push(linker);
}

/** Register a receipt for a final post-step retry-count refresh. */
export function registerEffectJournalRetryLinker(
  linker: EffectJournalRetryLinker,
): void {
  currentScopeFacet(effectJournalContextSlot)?.retryLinkers.push(linker);
}

/** Refresh linked receipts from finalized request inspection facts. */
export async function refreshEffectJournalRetryLinks(
  receipts: readonly RequestReceipt[],
): Promise<void> {
  for (const receipt of receipts) {
    const linkers = retryLinkersByRequest.get(receipt) ?? [];
    if (linkers.length === 0) continue;
    const retryCount = (await receipt.inspect()).retryCount;
    for (const linker of linkers) await linker(retryCount);
    retryLinkersByRequest.delete(receipt);
  }
}

/** Link every completed Effect in this tool to its canonical raw outcome. */
export async function linkEffectJournalOutcome(
  ref: EvidenceArtifactRef,
): Promise<void> {
  const context = currentScopeFacet(effectJournalContextSlot);
  if (!context) return;
  for (const linker of context.linkers) await linker(ref);
}
