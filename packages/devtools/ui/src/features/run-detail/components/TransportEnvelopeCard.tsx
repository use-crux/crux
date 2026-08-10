/** Closed, payload-safe Runs detail for accepted transport envelopes. */

import { Chip } from "@/devtools/shell/primitives";
import type { ObservabilityRunDetailNode } from "@/types";
import { CardShell, KeyValue } from "./SpanDetailPanelAtoms";

export function isTransportEnvelopeDetail(
  node: ObservabilityRunDetailNode,
): boolean {
  if (node.primitive !== "custom.operation") {
    return false;
  }

  const attributes = record(node.attributes);
  return (
    attributes?.kind === "transport.envelope" ||
    (record(attributes?.envelope) !== undefined &&
      stringValue(record(attributes?.envelope)?.bindingId) !== undefined)
  );
}

export function TransportEnvelopeCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  const attributes = record(node.attributes);
  const envelope = record(attributes?.envelope);
  const lineage = records(envelope?.lineage).slice(0, 64);
  const lastFailure = record(envelope?.lastFailure);
  const outcome = stringValue(attributes?.outcome);
  const state = stringValue(envelope?.state);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="plum">Transport envelope</Chip>
        {outcome && <Chip tone="muted">{outcome}</Chip>}
        {state && (
          <Chip
            tone={
              state === "dead-letter"
                ? "danger"
                : state === "normalized"
                  ? "ok"
                  : "muted"
            }
            dot
          >
            {state}
          </Chip>
        )}
      </div>

      <CardShell label="Envelope identity">
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <SafeValue k="Binding" value={envelope?.bindingId} />
          <SafeValue k="Adapter" value={envelope?.adapterId} />
          <SafeValue k="Provider" value={envelope?.provider} />
          <SafeValue k="Account" value={envelope?.accountId} />
          <SafeValue k="Event" value={envelope?.eventId} />
          <SafeValue k="Namespace" value={envelope?.namespace} />
          <SafeValue
            k="Config"
            value={
              stringValue(envelope?.configRefId)
                ? `${stringValue(envelope?.configRefId)}@${stringValue(envelope?.configRefRevision) ?? "?"}`
                : undefined
            }
          />
          <SafeValue k="Signal target" value={envelope?.targetSignalId} />
        </div>
      </CardShell>

      <CardShell label="Delivery">
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <Count k="Attempts" value={envelope?.attempts} />
          <Count k="Max attempts" value={envelope?.maxAttempts} />
          <SafeValue k="Accepted at" value={envelope?.acceptedAt} />
          <SafeValue k="Updated at" value={envelope?.updatedAt} />
          <SafeValue k="Next attempt" value={envelope?.nextAttemptAt} />
          {lastFailure && (
            <>
              <SafeValue k="Last failure code" value={lastFailure.code} />
              <SafeValue k="Last failure message" value={lastFailure.message} />
            </>
          )}
        </div>
      </CardShell>

      {lineage.length > 0 && (
        <CardShell
          label={`Signal lineage · ${lineage.length}${
            envelope?.lineageTruncated === true ? " · truncated" : ""
          }`}
        >
          <div className="divide-y divide-(--devtools-border)">
            {lineage.map((entry, index) => (
              <div
                key={`${stringValue(entry.occurrenceId) ?? "occ"}-${index}`}
                className="flex flex-col gap-1.5 px-3.5 py-3"
              >
                <SafeValue k="Signal" value={entry.signalId} />
                <SafeValue k="Occurrence" value={entry.occurrenceId} />
              </div>
            ))}
          </div>
        </CardShell>
      )}
    </div>
  );
}

function SafeValue({
  k,
  value,
}: {
  k: string;
  value: unknown;
}) {
  const text = stringValue(value);
  if (!text) {
    return null;
  }
  return <KeyValue k={k} v={text} />;
}

function Count({ k, value }: { k: string; value: unknown }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return <KeyValue k={k} v={String(value)} />;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
