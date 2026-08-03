import type React from "react";
import type { RuntimeInspectResponse } from "../types";

export function RuntimeWorkDetail({
  detail,
}: {
  detail?: RuntimeInspectResponse;
}) {
  if (!detail?.work)
    return (
      <EmptyRuntimeDetail label="Select a work item to inspect replay and error metadata." />
    );
  const { work, flow, application } = detail;
  return (
    <div className="grid gap-3 p-4 text-[12px] md:grid-cols-2">
      <Kv label="work id" value={work.workId} />
      <Kv label="target" value={work.targetId} />
      <Kv label="status" value={work.status} />
      <Kv label="attempts" value={`${work.attempt}/${work.maxAttempts}`} />
      {work.lastError && (
        <Kv
          label="last error"
          value={`${work.lastError.code}: ${work.lastError.message}`}
        />
      )}
      {flow && <Kv label="flow" value={`${flow.flowId} · ${flow.status}`} />}
      {flow && (
        <Kv
          label="fingerprint"
          value={flow.fingerprint.join(" → ") || "-"}
          wide
        />
      )}
      {application?.inputDigest && (
        <Kv label="input digest" value={application.inputDigest} wide />
      )}
      {application?.definition && (
        <Kv
          label="definition"
          value={`${application.definition.definitionId} · ${application.definition.fingerprint}`}
          wide
        />
      )}
      {application?.effects && (
        <Kv label="effect scope" value={application.effects.id} />
      )}
      {application && (
        <Kv label="ownership" value={application.ownership.state} />
      )}
      {application && (
        <Kv
          label="result lineage"
          value={
            application.result.ref?.sha256 ??
            (application.result.available ? "available" : "unavailable")
          }
          wide
        />
      )}
      {application?.statistics !== undefined && (
        <Kv
          label="statistics"
          value={JSON.stringify(application.statistics)}
          wide
        />
      )}
      {application && (
        <Kv
          label="timeline"
          value={`${application.events.length} ${application.events.length === 1 ? "event" : "events"}`}
        />
      )}
    </div>
  );
}

function Kv({
  label,
  value,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : undefined}>
      <div
        className="font-mono text-[10.5px] uppercase tracking-[0.06em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {label}
      </div>
      <div
        className="mt-1 break-words font-mono"
        style={{ color: "var(--devtools-fg)" }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyRuntimeDetail({ label }: { label: string }) {
  return (
    <div
      className="px-4 py-8 text-center text-[12px]"
      style={{ color: "var(--devtools-fg-muted)" }}
    >
      {label}
    </div>
  );
}
