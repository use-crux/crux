/**
 * Read-only evidence projection for settled effect receipts.
 *
 * @internal
 * @module
 */

import { activeEvidenceCollector } from "../../evidence/collector";
import { cloneAndFreezeEvidenceJson } from "../../evidence/freeze-json";
import { deterministicEvidenceId } from "../../evidence/idempotency";
import type {
  EvidenceRecord,
  EvidenceRef,
} from "../../evidence/record-types";
import type { JsonValue } from "../../storage";
import type { EffectReceipt } from "../receipt-types";
import type { EffectReceiptRef, EffectResource } from "../types";

const EFFECT_EVIDENCE_KIND = "custom.effect-receipt" as const;

/** Contribute intent and change evidence for one settled receipt. */
export function recordEffectReceiptSettlement(
  receipt: EffectReceipt,
): void {
  try {
    projectReceiptSettlement(receipt);
  } catch {}
}

/** Replace ambiguous change evidence after receipt reconciliation. */
export function recordEffectReceiptReconciliation(
  receipt: EffectReceipt,
): void {
  try {
    projectReceiptChange(receipt, new Date().toISOString(), true);
  } catch {}
}

/** Contribute evidence for a settled recovery-attempt receipt. */
export function recordEffectRecoveryAttempt(
  original: EffectReceipt,
  attempt: EffectReceipt,
): void {
  recordEffectReceiptSettlement(attempt);
  try {
    projectRecoverySettlement(original, attempt);
  } catch {}
}

/** Replace ambiguous recovery evidence after attempt reconciliation. */
export function recordEffectRecoveryReconciliation(
  original: EffectReceipt,
  attempt: EffectReceipt,
): void {
  recordEffectReceiptReconciliation(attempt);
  try {
    projectRecoverySettlement(original, attempt);
  } catch {}
}

function projectReceiptSettlement(receipt: EffectReceipt): void {
  const collector = activeEvidenceCollector(true);
  if (!collector || receipt.completedAt === undefined) return;
  for (const record of effectSettlementEvidenceRecords(receipt)) {
    appendOnce(collector, record);
  }
}

/** Build the deterministic read model for one settled receipt. @internal */
export function effectSettlementEvidenceRecords(
  receipt: EffectReceipt,
  recordedAt = new Date().toISOString(),
  changeSupersedes: readonly EvidenceRef[] = [],
): readonly EvidenceRecord[] {
  if (receipt.completedAt === undefined) return [];
  const subject = receiptRef(receipt);
  const observedAt = new Date(receipt.completedAt).toISOString();
  return Object.freeze([
    evidenceRecord({
      subject,
      role: "intent",
      recordedAt,
      observedAt,
      data: {
        effectId: receipt.effectId,
        effectVersion: receipt.effectVersion,
        ...(receipt.resource === undefined
          ? {}
          : { resource: resourceSummary(receipt.resource) }),
      },
    }),
    evidenceRecord({
      subject,
      role: "change",
      conclusion: changeConclusion(receipt),
      recordedAt,
      observedAt,
      supersedes: changeSupersedes,
      data: {
        outcome: receipt.outcome,
        recovery: receipt.recovery,
      },
    }),
  ]);
}

function projectReceiptChange(
  receipt: EffectReceipt,
  observedAt: string,
  supersedeExisting: boolean,
): void {
  const collector = activeEvidenceCollector(true);
  if (!collector || receipt.completedAt === undefined) return;
  const subject = receiptRef(receipt);
  appendOnce(
    collector,
    evidenceRecord({
      subject,
      role: "change",
      conclusion: changeConclusion(receipt),
      recordedAt: observedAt,
      observedAt,
      supersedes: supersedeExisting
        ? activeRefs(collector.snapshot(subject)?.records.change)
        : [],
      data: {
        outcome: receipt.outcome,
        recovery: receipt.recovery,
      },
    }),
  );
}

function projectRecoverySettlement(
  original: EffectReceipt,
  attempt: EffectReceipt,
): void {
  const collector = activeEvidenceCollector(true);
  if (!collector || attempt.completedAt === undefined) return;
  const subject = receiptRef(original);
  const record = effectRecoveryEvidenceRecord(original, attempt, {
    supersedes: activeRefs(
      collector.snapshot(subject)?.records.recovery,
    ),
  });
  if (record) appendOnce(collector, record);
}

/** Build recovery evidence linking one attempt to its original receipt. @internal */
export function effectRecoveryEvidenceRecord(
  original: EffectReceipt,
  attempt: EffectReceipt,
  options: {
    readonly recordedAt?: string;
    readonly supersedes?: readonly EvidenceRef[];
  } = {},
): EvidenceRecord | undefined {
  if (attempt.completedAt === undefined) return undefined;
  return evidenceRecord({
    subject: receiptRef(original),
    source: receiptRef(attempt),
    role: "recovery",
    conclusion: recoveryConclusion(attempt),
    recordedAt: options.recordedAt ?? new Date().toISOString(),
    observedAt: new Date(attempt.completedAt).toISOString(),
    supersedes: options.supersedes,
    data: {
      outcome: attempt.outcome,
      recovery: original.recovery,
    },
  });
}

function evidenceRecord(
  input:
    | {
        readonly subject: EffectReceiptRef;
        readonly source?: EffectReceiptRef;
        readonly role: "intent";
        readonly recordedAt: string;
        readonly observedAt: string;
        readonly supersedes?: readonly EvidenceRef[];
        readonly data: JsonValue;
      }
    | {
        readonly subject: EffectReceiptRef;
        readonly source?: EffectReceiptRef;
        readonly role: "change";
        readonly conclusion: "applied" | "no-change" | "unknown";
        readonly recordedAt: string;
        readonly observedAt: string;
        readonly supersedes?: readonly EvidenceRef[];
        readonly data: JsonValue;
      }
    | {
        readonly subject: EffectReceiptRef;
        readonly source: EffectReceiptRef;
        readonly role: "recovery";
        readonly conclusion: "succeeded" | "failed" | "partial";
        readonly recordedAt: string;
        readonly observedAt: string;
        readonly supersedes?: readonly EvidenceRef[];
        readonly data: JsonValue;
      },
): EvidenceRecord {
  const source = input.source ?? input.subject;
  return Object.freeze({
    ref: Object.freeze({
      kind: "execution.evidence",
      id: evidenceId(input, source),
      subject: input.subject,
      role: input.role,
      evidenceKind: EFFECT_EVIDENCE_KIND,
      recordedAt: input.recordedAt,
    }),
    source,
    ...("conclusion" in input
      ? { conclusion: input.conclusion }
      : {}),
    observedAt: input.observedAt,
    supersedes: Object.freeze([...(input.supersedes ?? [])]),
    payloadState: "available",
    data: cloneAndFreezeEvidenceJson(input.data),
  }) as EvidenceRecord;
}

function evidenceId(
  input: Parameters<typeof evidenceRecord>[0],
  source: EffectReceiptRef,
): EvidenceRef["id"] {
  const conclusion =
    "conclusion" in input ? `:${input.conclusion}` : "";
  return deterministicEvidenceId(
    input.subject,
    input.role,
    EFFECT_EVIDENCE_KIND,
    `effect-receipt:v1:${source.id}:${input.role}${conclusion}`,
  );
}

function appendOnce(
  collector: NonNullable<ReturnType<typeof activeEvidenceCollector>>,
  record: EvidenceRecord,
): void {
  const existing =
    collector.snapshot(record.ref.subject)?.records[record.ref.role] ?? [];
  if (existing.some(({ ref }) => ref.id === record.ref.id)) return;
  collector.append(record);
}

function activeRefs(
  records: readonly EvidenceRecord[] | undefined,
): readonly EvidenceRef[] {
  if (!records) return [];
  const superseded = new Set(
    records.flatMap((record) =>
      record.supersedes.map(({ id }) => id),
    ),
  );
  return records
    .filter(({ ref }) => !superseded.has(ref.id))
    .map(({ ref }) => ref);
}

function receiptRef(receipt: EffectReceipt): EffectReceiptRef {
  return Object.freeze({
    kind: "effect.receipt",
    id: receipt.id,
    effectId: receipt.effectId,
  });
}

function resourceSummary(
  resource: EffectResource | readonly EffectResource[],
): JsonValue {
  if (Array.isArray(resource)) {
    return resource.map((item) => resourceSummary(item));
  }
  const item = resource as EffectResource;
  return {
    type: item.type,
    ...(item.id === undefined ? {} : { id: item.id }),
    ...(item.namespace === undefined
      ? {}
      : { namespace: item.namespace }),
    ...(item.attributes === undefined
      ? {}
      : { attributes: { ...item.attributes } }),
  };
}

function changeConclusion(
  receipt: EffectReceipt,
): "applied" | "no-change" | "unknown" {
  if (receipt.outcome === "succeeded") return "applied";
  if (receipt.outcome === "unknown") return "unknown";
  return "no-change";
}

function recoveryConclusion(
  attempt: EffectReceipt,
): "succeeded" | "failed" | "partial" {
  if (attempt.outcome === "succeeded") return "succeeded";
  if (attempt.outcome === "unknown") return "partial";
  return "failed";
}
