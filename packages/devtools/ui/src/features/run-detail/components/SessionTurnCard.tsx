/** Closed, payload-safe Runs detail for `session.turn`. */

import { Chip } from "@/devtools/shell/primitives";
import type { ObservabilityRunDetailNode } from "@/types";
import { CardShell, KeyValue } from "./SpanDetailPanelAtoms";

export function SessionTurnCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  const attributes = record(node.attributes);
  const session = record(attributes?.session);
  const identity = record(session?.identity);
  const status = record(session?.status);
  const thread = record(session?.thread);
  const checkpoint = record(session?.checkpoint);
  const checkpointThread = record(checkpoint?.thread);
  const recovery = record(session?.recovery);
  const stats = record(session?.stats);
  const forkedFrom = record(session?.forkedFrom);
  const subscriptions = records(session?.subscriptions).slice(0, 64);
  const inputs = records(session?.inputs).slice(0, 64);
  const state = stringValue(status?.state);
  const outcome = stringValue(attributes?.outcome);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="plum">Session turn</Chip>
        {state && (
          <Chip tone={state === "blocked" ? "danger" : "muted"} dot>
            {state}
          </Chip>
        )}
        {outcome && outcome !== state && <Chip tone="muted">{outcome}</Chip>}
        {stringValue(identity?.targetKind) && (
          <Chip tone="muted">{stringValue(identity?.targetKind)}</Chip>
        )}
      </div>

      <CardShell label="Session identity">
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <SafeValue k="Session ID" value={identity?.sessionId} />
          <SafeValue k="Target" value={identity?.targetId} />
          <SafeValue k="Target kind" value={identity?.targetKind} />
          <SafeValue k="Thread ID" value={identity?.threadId} />
          <SafeValue k="Key fingerprint" value={identity?.keyHash} />
          <SafeValue k="Thread revision" value={thread?.revision} />
        </div>
      </CardShell>

      {forkedFrom && (
        <CardShell label="Fork lineage">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <SafeValue k="Parent Session" value={forkedFrom.sessionId} />
            <SafeValue k="Parent cursor" value={forkedFrom.cursor} />
            <SafeValue
              k="Pinned Thread revision"
              value={forkedFrom.threadRevision}
            />
          </div>
        </CardShell>
      )}

      <CardShell label="State">
        <div className="flex flex-col gap-1.5 px-3.5 py-3">
          <SafeValue k="Accepted cursor" value={status?.acceptedCursor} />
          <SafeValue k="Processed cursor" value={status?.processedCursor} />
          <Count k="Pending inputs" value={status?.pendingInputs} />
          <Count k="Pending Work" value={status?.pendingWork} />
          {typeof session?.wakePending === "boolean" && (
            <KeyValue k="Wake pending" v={session.wakePending ? "yes" : "no"} />
          )}
        </div>
      </CardShell>

      {subscriptions.length > 0 && (
        <CardShell label={`Active subscriptions · ${subscriptions.length}`}>
          <div className="divide-y divide-(--devtools-border)">
            {subscriptions.map((subscription, index) => (
              <div
                key={`${stringValue(subscription.subscriptionId) ?? "sub"}-${index}`}
                className="flex flex-col gap-1.5 px-3.5 py-3"
              >
                <SafeValue k="Subscription" value={subscription.subscriptionId} />
                <SafeValue k="Signal" value={subscription.signalId} />
                <SafeValue
                  k="Match key"
                  value={
                    stringValue(subscription.matchKey) === ""
                      ? "(bare)"
                      : subscription.matchKey
                  }
                />
                <SafeValue k="State" value={subscription.state} />
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {inputs.length > 0 && (
        <CardShell label={`Turn lineage · ${inputs.length}`}>
          <div className="divide-y divide-(--devtools-border)">
            {inputs.map((input, index) => (
              <InputLine
                key={`${stringValue(input.inputId) ?? "input"}-${index}`}
                input={input}
              />
            ))}
          </div>
        </CardShell>
      )}

      {checkpoint && (
        <CardShell label="Recovery checkpoint">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <SafeValue k="Input" value={checkpoint.inputId} />
            <SafeValue k="Work" value={checkpoint.workId} />
            <SafeValue k="Prepared at" value={checkpoint.checkpointedAt} />
            <SafeValue k="Basis revision" value={checkpointThread?.revision} />
            <SafeValue k="Basis range" value={checkpointThread?.range} />
            <Count k="Basis offset" value={checkpointThread?.offset} />
            <Count k="Basis length" value={checkpointThread?.length} />
            <RequestCount
              value={checkpoint.requestCount}
              coverage={checkpoint.requestCoverage}
            />
          </div>
        </CardShell>
      )}

      {recovery && (
        <CardShell label="Recovery required">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <SafeValue k="Code" value={recovery.code} />
            <SafeValue k="Next step" value={recovery.nextStep} />
          </div>
        </CardShell>
      )}

      {stats && <StatisticsCard stats={stats} />}
    </div>
  );
}

function InputLine({ input }: { input: Readonly<Record<string, unknown>> }) {
  const delivery = record(input.delivery);
  const cursor = stringValue(input.cursor);
  const state = stringValue(input.state);
  const workId = stringValue(input.workId);
  const reason = stringValue(delivery?.reason);
  const step = numberValue(delivery?.stepIndex);
  return (
    <div className="flex flex-col gap-1.5 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {cursor && (
          <Chip tone="plum" mono>
            cursor {cursor}
          </Chip>
        )}
        {state && (
          <Chip tone={state === "blocked" ? "danger" : "muted"}>{state}</Chip>
        )}
        {input.checkpointPrepared === true && (
          <Chip tone="muted">checkpointed</Chip>
        )}
      </div>
      <SafeValue k="Input" value={input.inputId} />
      {workId && <KeyValue k="Canonical Work" v={workId} />}
      {reason && (
        <KeyValue
          k="Delivery"
          v={`${reason}${step === undefined ? "" : ` · step ${step}`}`}
        />
      )}
      <SafeValue k="Delivered at" value={delivery?.deliveredAt} />
    </div>
  );
}

function StatisticsCard({
  stats,
}: {
  stats: Readonly<Record<string, unknown>>;
}) {
  const work = record(stats.work);
  const total = record(work?.total);
  const current = record(total?.current);
  const modelCalls = record(stats.modelCalls);
  const failures = record(stats.failures);
  const inputs = record(stats.inputs);
  const inputTotal = record(inputs?.total);
  const currentParts = [
    countLabel(current?.queued, "queued"),
    countLabel(current?.running, "running"),
    countLabel(current?.blocked, "blocked"),
  ].filter(Boolean);
  return (
    <CardShell label="Bounded statistics">
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <Count k="Work started" value={total?.started} />
        <Count k="Work completed" value={total?.completed} />
        {currentParts.length > 0 && (
          <KeyValue k="Current Work" v={currentParts.join(" · ")} />
        )}
        <Count k="Model calls started" value={modelCalls?.started} />
        <Count k="Model calls succeeded" value={modelCalls?.succeeded} />
        <Count k="Model calls failed" value={modelCalls?.failed} />
        <Count k="Failures" value={failures?.total} />
        {inputTotal && (
          <>
            <Count k="Ingress accepted" value={inputTotal.accepted} />
            <Count k="Ingress deduplicated" value={inputTotal.deduplicated} />
            <Count k="Ingress delivered" value={inputTotal.delivered} />
            <Count k="Ingress resumed" value={inputTotal.resumed} />
            <Count k="Ingress dropped" value={inputTotal.dropped} />
          </>
        )}
      </div>
    </CardShell>
  );
}

function SafeValue({ k, value }: { k: string; value: unknown }) {
  const safe = stringValue(value);
  return safe ? <KeyValue k={k} v={safe} /> : null;
}

function Count({ k, value }: { k: string; value: unknown }) {
  const count = numberValue(value);
  return count === undefined ? null : <KeyValue k={k} v={String(count)} />;
}

function RequestCount({
  value,
  coverage,
}: {
  value: unknown;
  coverage: unknown;
}) {
  const count = numberValue(value);
  if (count === undefined) return null;
  const suffix = stringValue(coverage);
  return (
    <KeyValue
      k="Provider decisions"
      v={`${count} request${count === 1 ? "" : "s"}${suffix ? ` · ${suffix}` : ""}`}
    />
  );
}

function countLabel(value: unknown, label: string): string | undefined {
  const count = numberValue(value);
  return count === undefined ? undefined : `${count} ${label}`;
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function records(
  value: unknown,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  return Array.isArray(value)
    ? value
        .map(record)
        .filter((item): item is Readonly<Record<string, unknown>> =>
          Boolean(item),
        )
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
