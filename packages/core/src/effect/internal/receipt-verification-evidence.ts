/**
 * Internal verification evidence projection for settled effect receipts.
 *
 * @internal
 * @module
 */

import { activeEvidenceCollector } from "../../evidence/collector";
import { cloneAndFreezeEvidenceJson } from "../../evidence/freeze-json";
import { deterministicEvidenceId } from "../../evidence/idempotency";
import type { EvidenceRecord } from "../../evidence/record-types";
import type { JsonValue } from "../../storage";
import type { EffectReceiptRef } from "../types";

const EFFECT_EVIDENCE_KIND = "custom.effect-receipt" as const;

/** Contribute verification evidence for one settled effect receipt. */
export function recordEffectReceiptVerification(
  receipt: EffectReceiptRef,
  data: JsonValue,
): void {
  try {
    const collector = activeEvidenceCollector(true);
    if (!collector) return;
    collector.append(verificationRecord(receipt, data));
  } catch {}
}

function verificationRecord(
  receipt: EffectReceiptRef,
  data: JsonValue,
): EvidenceRecord<"verification"> {
  const recordedAt = new Date().toISOString();
  return Object.freeze({
    ref: Object.freeze({
      kind: "execution.evidence",
      id: deterministicEvidenceId(
        receipt,
        "verification",
        EFFECT_EVIDENCE_KIND,
        `effect-receipt:v1:${receipt.id}:verification:passed`,
      ),
      subject: receipt,
      role: "verification",
      evidenceKind: EFFECT_EVIDENCE_KIND,
      recordedAt,
    }),
    source: receipt,
    conclusion: "passed",
    observedAt: recordedAt,
    supersedes: Object.freeze([]),
    payloadState: "available",
    data: cloneAndFreezeEvidenceJson(data),
  }) as EvidenceRecord<"verification">;
}
