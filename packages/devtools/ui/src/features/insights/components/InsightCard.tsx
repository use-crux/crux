import { useMemo, useState } from "react";
import { Btn, Chip, Sparkline, type ChipTone } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import { DevtoolsTooltip } from "@/devtools/shell/DevtoolsTooltip";
import { DevtoolsConfirm } from "@/devtools/shell/DevtoolsConfirm";
import { useNavigation } from "@/app/navigation/useNavigation";
import {
  SEV_LABEL,
  SEV_TONE,
  timeAgo,
} from "@/features/insights/lib/insight-format";
import type { InspectInsightRecord, InspectRunRecord } from "@/types";

/** What the insight is about — drives the kind chip + the primary action. */
type InsightKind = "source" | "insight";

const KIND_ICON: Record<InsightKind, IconName> = {
  source: "doc",
  insight: "sparkle",
};

function insightKind(ins: InspectInsightRecord): InsightKind {
  if (ins.linkedDefinitionIds?.length || ins.linkedSources?.length)
    return "source";
  return "insight";
}

export function InsightCard({
  ins,
  traceLookup,
  onResolve,
  onSilencePattern,
}: {
  ins: InspectInsightRecord;
  traceLookup: ReadonlyMap<string, InspectRunRecord>;
  onResolve: () => void;
  onSilencePattern: () => void;
}) {
  const { navigate } = useNavigation();
  const stripeColor =
    ins.severity === "high"
      ? "var(--devtools-danger)"
      : ins.severity === "medium"
        ? "var(--devtools-warn)"
        : "var(--devtools-iris)";

  const kind = insightKind(ins);
  const linkedTraceIds = ins.linkedTraceIds ?? [];
  const linkedCount = linkedTraceIds.length;
  const occurrenceCount = ins.occurrenceCount || linkedCount;
  const [expanded, setExpanded] = useState(linkedCount === 1);

  const occurrenceTargets = useMemo(() => {
    const set = new Set<string>();
    for (const id of linkedTraceIds) {
      const t = traceLookup.get(id)?.targetId;
      if (t) set.add(t);
    }
    if (ins.targetId) set.add(ins.targetId);
    return Array.from(set);
  }, [linkedTraceIds, traceLookup, ins.targetId]);

  return (
    <div
      className="grid gap-6 rounded-[10px] px-[22px] py-[18px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
        borderLeft: `3px solid ${stripeColor}`,
        gridTemplateColumns: "1fr 240px",
      }}
    >
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Chip tone={SEV_TONE[ins.severity]} dot>
            {SEV_LABEL[ins.severity]}
          </Chip>
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            <Icon name={KIND_ICON[kind]} size={12} color="var(--devtools-fg-muted)" />
            {kind}
          </span>
          {ins.tags.map((t) => (
            <Chip key={t} tone="muted">
              {t}
            </Chip>
          ))}
          {occurrenceTargets.length === 1 && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              target · {occurrenceTargets[0]}
            </span>
          )}
          {occurrenceTargets.length > 1 && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              {occurrenceTargets.length} targets
            </span>
          )}
          {occurrenceCount > 0 && (
            <Chip tone="crux" mono>
              {occurrenceCount} occurrence{occurrenceCount === 1 ? "" : "s"}
            </Chip>
          )}
          {ins.reopenedAt && (
            <Chip
              tone="warn"
              mono
              title={
                ins.previousResolutionAt
                  ? `Previously resolved ${timeAgo(ins.previousResolutionAt)} — issue returned`
                  : "Auto-reopened: occurrenceCount grew past the resolved snapshot"
              }
            >
              Reopened · {timeAgo(ins.reopenedAt)}
            </Chip>
          )}
          <span
            className="ml-auto font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            {timeAgo(ins.updatedAt)}
          </span>
        </div>
        <h3 className="m-0 mb-1.5 text-[17px] font-semibold tracking-[-0.012em] leading-[1.3]">
          {ins.title}
        </h3>
        <p
          className="m-0 mb-3 max-w-[680px] text-[13.5px] leading-[1.55]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {ins.summary}
        </p>
        {ins.proposedFix && (
          <div
            className="flex max-w-[680px] items-start gap-2 rounded-[6px] px-2.5 py-2 text-[12px]"
            style={{
              background: "var(--devtools-crux-soft)",
              border: "1px dashed var(--devtools-crux-line)",
            }}
          >
            <Icon name="sparkle" size={13} color="var(--devtools-crux)" />
            <div>
              <span
                className="mr-1.5 font-semibold"
                style={{ color: "var(--devtools-crux)" }}
              >
                Proposed fix
              </span>
              {ins.proposedFix}
            </div>
          </div>
        )}

        <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
          {linkedCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[5px] font-mono text-[11.5px] transition-colors hover:opacity-90"
              style={{
                background: "var(--devtools-bg-muted)",
                color: "var(--devtools-fg)",
                border: "1px solid var(--devtools-border)",
              }}
              title={
                linkedCount === 1
                  ? "View occurrence"
                  : `${expanded ? "Hide" : "Show"} ${linkedCount} occurrences`
              }
            >
              <Icon
                name={expanded ? "arrowDown" : "arrowRight"}
                size={11}
                color="var(--devtools-crux)"
              />
              {linkedCount} occurrence{linkedCount === 1 ? "" : "s"}
            </button>
          )}
          <DevtoolsTooltip content="Mark as fixed. Auto-reopens if more occurrences are detected.">
            <Btn
              size="xs"
              icon={<Icon name="check" size={12} />}
              onClick={onResolve}
            >
              Resolve
            </Btn>
          </DevtoolsTooltip>
          <DevtoolsConfirm
            title={`Silence "${ins.title}"?`}
            description={
              <>
                Future insights matching <strong>{ins.title}</strong>
                {ins.targetId ? (
                  <>
                    {" "}
                    on <strong>{ins.targetId}</strong>
                  </>
                ) : (
                  " across all targets"
                )}{" "}
                will be hidden from the feed. You can unsilence them at any time
                from the silences strip above.
              </>
            }
            confirmLabel="Silence pattern"
            tone="warn"
            tooltip={`Hide all "${ins.title}"${
              ins.targetId ? ` on ${ins.targetId}` : ""
            } insights going forward · reversible from the silences strip`}
            onConfirm={onSilencePattern}
          >
            <Btn size="xs" icon={<Icon name="x" size={12} />}>
              Silence pattern
            </Btn>
          </DevtoolsConfirm>
        </div>

        {expanded && linkedCount > 0 && (
          <div
            className="mt-3 overflow-hidden rounded-[6px]"
            style={{ border: "1px solid var(--devtools-border)" }}
          >
            <div
              className="px-3 py-2 font-mono text-[10px] uppercase tracking-[0.08em]"
              style={{
                color: "var(--devtools-fg-faint)",
                background: "var(--devtools-bg-muted)",
                borderBottom: "1px solid var(--devtools-border)",
              }}
            >
              Occurrences · {linkedCount}
              {occurrenceCount > linkedCount && (
                <span style={{ textTransform: "none", marginLeft: 8 }}>
                  ({occurrenceCount} total — backend returned first{" "}
                  {linkedCount})
                </span>
              )}
            </div>
            <div
              className="flex flex-col"
              style={{ background: "var(--devtools-bg)" }}
            >
              {linkedTraceIds.slice(0, 5).map((traceId) => (
                <OccurrenceRow
                  key={traceId}
                  traceId={traceId}
                  run={traceLookup.get(traceId)}
                />
              ))}
              {linkedTraceIds.length > 5 && (
                <div
                  className="px-3 py-2 font-mono text-[11px]"
                  style={{
                    color: "var(--devtools-fg-muted)",
                    borderTop: "1px solid var(--devtools-border)",
                    background: "var(--devtools-bg-muted)",
                  }}
                >
                  + {linkedTraceIds.length - 5} more occurrences ·{" "}
                  <span style={{ color: "var(--devtools-fg-faint)" }}>
                    full pagination pending backend (see #529)
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <div
          className="text-[10px] font-medium uppercase tracking-[0.16em]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          Trend
        </div>
        <div
          className="rounded-[6px] px-3 py-2.5"
          style={{
            background: "var(--devtools-bg)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          {ins.trend && ins.trend.length > 1 ? (
            <Sparkline data={ins.trend} width={216} height={48} />
          ) : (
            <div
              className="text-[11px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              No trend recorded yet.
            </div>
          )}
        </div>
        <div className="flex gap-1.5">
          <div
            className="flex-1 rounded-[6px] px-2.5 py-1.5"
            style={{
              background: "var(--devtools-bg)",
              border: "1px solid var(--devtools-border)",
            }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.1em]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              Occurrences
            </div>
            <div className="font-mono text-[16px] font-semibold">
              {occurrenceCount}
            </div>
            {occurrenceCount > linkedCount && (
              <div
                className="text-[10.5px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {linkedCount} linked
              </div>
            )}
          </div>
          <div
            className="flex-1 rounded-[6px] px-2.5 py-1.5"
            style={{
              background: "var(--devtools-bg)",
              border: "1px solid var(--devtools-border)",
            }}
          >
            <div
              className="text-[10px] uppercase tracking-[0.1em]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              Severity
            </div>
            <div className="mt-0.5 text-[12px] font-medium">
              {SEV_LABEL[ins.severity]}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OccurrenceRow({
  traceId,
  run,
}: {
  traceId: string;
  run: InspectRunRecord | undefined;
}) {
  const { navigate } = useNavigation();
  const shortId =
    traceId.length > 8
      ? `${traceId.slice(0, 4)}…${traceId.slice(-2)}`
      : traceId;
  const startedAt = run?.startedAt;
  const target = run?.targetId;
  const status = run?.status;
  const dur = run?.durationMs;
  const statusTone: ChipTone =
    status === "success" || status === "ok"
      ? "ok"
      : status === "running"
        ? "crux"
        : status === "error" || status === "failed"
          ? "danger"
          : status === "suspended"
            ? "iris"
            : "muted";
  return (
    <div
      className="grid items-center gap-3 px-3 py-2 text-[12px]"
      style={{
        gridTemplateColumns: "76px 70px 70px 1fr auto",
        borderBottom: "1px solid var(--devtools-border)",
      }}
    >
      <button
        type="button"
        onClick={() => navigate({ view: "run-detail", traceId })}
        className="truncate text-left font-mono text-[11.5px] transition-colors hover:underline"
        style={{ color: "var(--devtools-crux)" }}
        title={traceId}
      >
        {shortId}
      </button>
      <span
        className="font-mono text-[10.5px]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {startedAt ? timeAgo(new Date(startedAt).toISOString()) : "—"}
      </span>
      <span
        className="font-mono text-[10.5px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        {dur != null
          ? dur < 1000
            ? `${Math.round(dur)}ms`
            : `${(dur / 1000).toFixed(1)}s`
          : "—"}
      </span>
      <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[11px]">
        {status && (
          <Chip tone={statusTone} mono>
            {status}
          </Chip>
        )}
        <span className="truncate" style={{ color: "var(--devtools-fg)" }}>
          {target ?? (
            <span style={{ color: "var(--devtools-fg-faint)" }}>
              (not in runs cache)
            </span>
          )}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <DevtoolsTooltip content="Open this trace in the Run detail view">
          <Btn
            size="xs"
            icon={<Icon name="trace" size={11} />}
            onClick={() => navigate({ view: "run-detail", traceId })}
          >
            Open
          </Btn>
        </DevtoolsTooltip>
      </span>
    </div>
  );
}
