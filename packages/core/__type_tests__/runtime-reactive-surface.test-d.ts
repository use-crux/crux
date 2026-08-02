import type {
  RuntimeSignalStorePort,
  SignalOccurrenceRecord,
} from "@use-crux/core/runtime";

const occurrence = {
  schemaVersion: 1,
  namespace: "tenant-a",
  occurrenceId: "occurrence-a",
  signalId: "orders.changed",
  payload: null,
  acceptedAt: "2026-08-01T00:00:00.000Z",
  // @ts-expect-error Provider envelopes are not part of the shipped Child A record.
  source: {
    kind: "provider-envelope",
    providerId: "provider-a",
    envelopeId: "envelope-a",
  },
} satisfies SignalOccurrenceRecord;
void occurrence;

declare const signals: RuntimeSignalStorePort;
// @ts-expect-error Session subscription persistence is not part of Child A.
signals.putSubscription;
