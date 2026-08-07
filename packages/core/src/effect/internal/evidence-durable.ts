/** Runtime-store read model for durable Effect receipt evidence. @internal */

import type {
  EvidenceDestinationInspectRequest,
  EvidenceDestinationInspectResult,
  EvidenceDestinationRoleResult,
} from "../../evidence/destination";
import type { EvidenceRecord } from "../../evidence/record-types";
import type { EvidenceRole } from "../../evidence/roles";
import type {
  DurableEffectReconciliationRecord,
  DurableEffectScopeSnapshot,
} from "../../runtime/ports/effects";
import { currentDurableEffectLedgerBinding } from "./durable-binding";
import {
  effectRecoveryEvidenceRecord,
  effectSettlementEvidenceRecords,
} from "./evidence";

/** Resolve one persisted Effect receipt through the Runtime store bridge. */
export async function inspectDurableEffectEvidence(
  request: EvidenceDestinationInspectRequest,
): Promise<EvidenceDestinationInspectResult | undefined> {
  if (request.subject.kind !== "effect.receipt" || request.cursor) {
    return undefined;
  }
  const binding = currentDurableEffectLedgerBinding();
  const effects = binding?.store.effects;
  if (!binding || !effects) return undefined;
  const stored = await effects.getReceipt(request.subject.id, {
    namespace: binding.namespace,
  });
  if (!stored || stored.receipt.effectId !== request.subject.effectId) {
    return undefined;
  }
  const snapshot = stored.receipt.runId
    ? await effects.reconstructScope(
        {
          kind: "effect.scope",
          id: stored.receipt.boundaryId,
          runId: stored.receipt.runId,
        },
        { namespace: binding.namespace },
      )
    : null;
  const recordedAt = new Date(
    stored.receipt.completedAt ?? stored.receipt.startedAt,
  ).toISOString();
  const records = [
    ...durableSettlementRecords(
      stored.receipt,
      recordedAt,
      snapshot?.reconciliations ?? [],
    ),
    ...durableRecoveryRecords(stored.receipt, snapshot),
  ];
  return Object.freeze({
    subject: request.subject,
    roles: Object.freeze({
      intent: roleResult("intent", records, request),
      authority: roleResult("authority", records, request),
      change: roleResult("change", records, request),
      verification: roleResult("verification", records, request),
      recovery: roleResult("recovery", records, request),
    }),
  });
}

function durableRecoveryRecords(
  receipt: import("../receipt-types").EffectReceipt,
  snapshot: DurableEffectScopeSnapshot | null,
): readonly EvidenceRecord[] {
  if (!snapshot) return [];
  const receipts = new Map(
    snapshot.receipts.map((record) => [record.receipt.id, record.receipt]),
  );
  const attempts = snapshot.attempts
    .filter((attempt) => attempt.originalReceiptId === receipt.id)
    .flatMap((attempt) => {
      const attemptReceipt = receipts.get(attempt.attemptReceiptId);
      return attemptReceipt ? [attemptReceipt] : [];
    })
    .sort(
      (left, right) =>
        (left.completedAt ?? left.startedAt) -
          (right.completedAt ?? right.startedAt) ||
        left.id.localeCompare(right.id),
    );
  const records: EvidenceRecord[] = [];
  for (const attempt of attempts) {
    const previous = records.at(-1);
    const reconciliation = snapshot.reconciliations.find(
      (record) => record.receiptId === attempt.id,
    );
    const settledAttempt =
      attempt.completedAt === undefined && reconciliation
        ? Object.freeze({
            ...attempt,
            completedAt: reconciliation.reconciledAt,
          })
        : attempt;
    const originalAtAttempt = Object.freeze({
      ...receipt,
      recovery:
        settledAttempt.outcome === "succeeded"
          ? "recovered" as const
          : settledAttempt.outcome === "unknown"
            ? "ambiguous" as const
            : "available" as const,
    });
    const ambiguous = reconciliation
      ? effectRecoveryEvidenceRecord(
          Object.freeze({ ...originalAtAttempt, recovery: "ambiguous" }),
          Object.freeze({ ...settledAttempt, outcome: "unknown" }),
          {
            recordedAt: new Date(
              settledAttempt.completedAt ?? settledAttempt.startedAt,
            ).toISOString(),
            ...(previous ? { supersedes: [previous.ref] } : {}),
          },
        )
      : undefined;
    if (ambiguous) records.push(ambiguous);
    const superseded = records.at(-1);
    const record = effectRecoveryEvidenceRecord(
      originalAtAttempt,
      settledAttempt,
      {
      recordedAt: new Date(
        reconciliation?.reconciledAt ??
          settledAttempt.completedAt ??
          settledAttempt.startedAt,
      ).toISOString(),
      ...(superseded ? { supersedes: [superseded.ref] } : {}),
      },
    );
    if (record) records.push(record);
  }
  return records;
}

function durableSettlementRecords(
  receipt: import("../receipt-types").EffectReceipt,
  recordedAt: string,
  reconciliations: readonly DurableEffectReconciliationRecord[],
): readonly EvidenceRecord[] {
  const reconciliation = reconciliations.find(
    (record) => record.receiptId === receipt.id,
  );
  if (!reconciliation) {
    return effectSettlementEvidenceRecords(receipt, recordedAt);
  }
  const settledReceipt = receipt.completedAt === undefined
    ? Object.freeze({
        ...receipt,
        completedAt: reconciliation.reconciledAt,
      })
    : receipt;
  const historical = effectSettlementEvidenceRecords(
    Object.freeze({
      ...settledReceipt,
      outcome: "unknown",
      recovery: "ambiguous",
    }),
    recordedAt,
  ).find((record) => record.ref.role === "change");
  const current = effectSettlementEvidenceRecords(
    settledReceipt,
    new Date(reconciliation.reconciledAt).toISOString(),
    historical ? [historical.ref] : [],
  );
  return historical
    ? [
        ...current.filter((record) => record.ref.role === "intent"),
        historical,
        ...current.filter((record) => record.ref.role === "change"),
      ]
    : current;
}

function roleResult<R extends EvidenceRole>(
  role: R,
  records: readonly EvidenceRecord[],
  request: EvidenceDestinationInspectRequest,
): EvidenceDestinationRoleResult<R> {
  const matching = records.filter((record) => record.ref.role === role);
  const supersededIds = new Set(
    matching.flatMap((record) => record.supersedes.map((ref) => ref.id)),
  );
  const active = matching.filter(
    (record) => !supersededIds.has(record.ref.id),
  );
  const history = matching.filter((record) => supersededIds.has(record.ref.id));
  const hydrated =
    request.role === undefined || request.role === role
      ? active
          .slice(0, request.limit)
          .map((record) => (request.includeData ? record : withoutData(record)))
      : [];
  const hydratedHistory =
    request.includeHistory &&
    (request.role === undefined || request.role === role)
      ? history
          .slice(0, request.limit)
          .map((record) => (request.includeData ? record : withoutData(record)))
      : undefined;
  const conclusions = new Set(
    active.flatMap((record) =>
      record.conclusion === undefined ? [] : [record.conclusion],
    ),
  );
  return Object.freeze({
    role,
    status: active.length > 0 ? "present" : "not-yet-recorded",
    activeRecordCount: active.length,
    records: Object.freeze(hydrated) as readonly EvidenceRecord<R>[],
    ...(hydratedHistory
      ? { history: Object.freeze(hydratedHistory) as readonly EvidenceRecord<R>[] }
      : {}),
    ...(conclusions.size === 1 ? { conclusion: [...conclusions][0] } : {}),
    conflicting: conclusions.size > 1,
    truncated:
      active.length > request.limit || history.length > request.limit,
  }) as EvidenceDestinationRoleResult<R>;
}

function withoutData(record: EvidenceRecord): EvidenceRecord {
  const {
    data: _data,
    payloadUnavailableReason: _reason,
    ...reference
  } = record;
  return Object.freeze({
    ...reference,
    payloadState: "reference",
  }) as EvidenceRecord;
}
