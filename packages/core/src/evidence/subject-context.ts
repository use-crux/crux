import {
  createScopeFacetSlot,
  currentScopeFacet,
  runWithScopeFacet,
} from "../scope/internal";
import type { EvidenceEffectReceiptRef } from "./subjects";

const effectReceiptSubjectFacet =
  createScopeFacetSlot<EvidenceEffectReceiptRef>(
    "core.evidence-effect-receipt",
  );

/** Return the nearest Effects-owned receipt subject. @internal */
export function currentEvidenceEffectReceiptSubject():
  | EvidenceEffectReceiptRef
  | undefined {
  return currentScopeFacet(effectReceiptSubjectFacet);
}

/** Run future Effects work with its immutable receipt as evidence subject. @internal */
export function runWithEvidenceEffectReceiptSubject<R>(
  receipt: EvidenceEffectReceiptRef,
  fn: () => R,
): R {
  return runWithScopeFacet(effectReceiptSubjectFacet, receipt, fn);
}
