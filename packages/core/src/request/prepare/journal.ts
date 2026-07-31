/**
 * Content-free in-memory decision journal for accepted preparation boundaries.
 *
 * @module
 */

import type { ExecutionAmendment } from "./amendment";
import type { PreparationResourceRead } from "./resources";
import type { StepReason } from "./step-context";

/** Redacted accepted-decision facts retained with a live request receipt. */
export interface PreparationDecisionInspection {
  /** Operation family prepared by the callback. */
  readonly operation: "language";
  /** Zero-based semantic provider-call index. */
  readonly stepIndex: number;
  /** Safe boundary classification. */
  readonly reason: StepReason;
  /** Content-free summary of the accepted requested delta. */
  readonly amendment: {
    readonly addedContributors: number;
    readonly removedContributors: number;
    readonly contributedTools: number;
    readonly activeTools: number | undefined;
    readonly modelChanged: boolean;
    readonly inputBudgetChanged: boolean;
  };
  /** Pinned resource identities, revisions, and privacy-preserving hashes. */
  readonly resources: readonly PreparationResourceRead[];
  /** Identity of the sealed request committed with this decision. */
  readonly sealedRequestId: string;
}

const decisions = new WeakMap<object, PreparationDecisionInspection>();

/** Commit an accepted decision only after its request plan is sealed. @internal */
export function commitPreparationDecision(input: {
  readonly receipt: object;
  readonly requestId: string;
  readonly stepIndex: number;
  readonly reason: StepReason;
  readonly amendment?: ExecutionAmendment;
  readonly resources: readonly PreparationResourceRead[];
}): void {
  const amendment = input.amendment;
  decisions.set(
    input.receipt,
    Object.freeze({
      operation: "language",
      stepIndex: input.stepIndex,
      reason: input.reason,
      amendment: Object.freeze({
        addedContributors: amendment?.use?.add?.length ?? 0,
        removedContributors: amendment?.use?.remove?.length ?? 0,
        contributedTools: Object.keys(amendment?.tools ?? {}).length,
        activeTools: amendment?.activeTools?.length,
        modelChanged: amendment?.model !== undefined,
        inputBudgetChanged: amendment?.inputBudget !== undefined,
      }),
      resources: Object.freeze([...input.resources]),
      sealedRequestId: input.requestId,
    }),
  );
}

/** Read one committed decision from a live receipt. @internal */
export function preparationDecision(
  receipt: object,
): PreparationDecisionInspection | undefined {
  return decisions.get(receipt);
}
