import { useMemo } from "react";

interface PlanTaskTimelineProps {
  planEvents: Array<{
    type: string;
    planId: string;
    title?: string;
    version?: number;
    timestamp: number;
  }>;
  taskEvents: Array<{
    type: string;
    taskListId: string;
    taskId: string;
    label?: string;
    status?: string;
    timestamp: number;
  }>;
}

interface TimelineEntry {
  key: string;
  timestamp: number;
  kind: "plan" | "task";
  type: string;
  description: string;
  detail?: string;
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function planDescription(
  type: string,
  title?: string,
  version?: number,
): string {
  const t = title ? `"${title}"` : "plan";
  const v = version != null ? ` v${version}` : "";
  switch (type) {
    case "created":
      return `Plan created: ${t}${v}`;
    case "updated":
      return `Plan updated: ${t}${v}`;
    case "approved":
      return `Plan approved: ${t}${v}`;
    case "rejected":
      return `Plan rejected: ${t}${v}`;
    case "executing":
      return `Plan executing: ${t}${v}`;
    case "completed":
      return `Plan completed: ${t}${v}`;
    default:
      return `Plan ${type}: ${t}${v}`;
  }
}

function taskDescription(
  type: string,
  label?: string,
  status?: string,
): string {
  const l = label ?? "task";
  switch (type) {
    case "added":
      return `Task added: ${l}`;
    case "updated":
      return `Task updated: ${l}${status ? ` [${status}]` : ""}`;
    case "removed":
      return `Task removed: ${l}`;
    case "completed":
      return `Task completed: ${l}`;
    case "failed":
      return `Task failed: ${l}`;
    default:
      return `Task ${type}: ${l}${status ? ` [${status}]` : ""}`;
  }
}

const TASK_STATUS_COLOR: Record<string, string> = {
  completed: "var(--qw-ok)",
  failed: "var(--qw-danger)",
  added: "var(--qw-crux)",
  removed: "var(--qw-fg-faint)",
};

export function PlanTaskTimeline({
  planEvents,
  taskEvents,
}: PlanTaskTimelineProps) {
  const entries = useMemo(() => {
    const all: TimelineEntry[] = [];
    for (const e of planEvents) {
      all.push({
        key: `plan-${e.planId}-${e.type}-${e.timestamp}`,
        timestamp: e.timestamp,
        kind: "plan",
        type: e.type,
        description: planDescription(e.type, e.title, e.version),
        detail: e.planId.slice(0, 8),
      });
    }
    for (const e of taskEvents) {
      all.push({
        key: `task-${e.taskListId}-${e.taskId}-${e.type}-${e.timestamp}`,
        timestamp: e.timestamp,
        kind: "task",
        type: e.type,
        description: taskDescription(e.type, e.label, e.status),
        detail: e.taskId.slice(0, 8),
      });
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all;
  }, [planEvents, taskEvents]);

  if (entries.length === 0) {
    return (
      <div
        className="py-4 text-center text-[12px]"
        style={{ color: "var(--qw-fg-faint)" }}
      >
        No plan or task events
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry) => {
        const typeColor =
          entry.kind === "task"
            ? (TASK_STATUS_COLOR[entry.type] ?? "var(--qw-fg-muted)")
            : "var(--qw-fg-muted)";
        return (
          <div key={entry.key} className="flex items-center gap-2 px-3 py-1">
            <span
              className="w-16 shrink-0 font-mono text-[10.5px] tabular-nums"
              style={{ color: "var(--qw-fg-faint)" }}
            >
              {formatTs(entry.timestamp)}
            </span>
            <span
              className="w-4 shrink-0 text-center font-mono text-[10.5px] uppercase tracking-[0.08em]"
              style={{ color: "var(--qw-fg-muted)" }}
            >
              {entry.kind === "plan" ? "P" : "T"}
            </span>
            <span
              className="shrink-0 font-mono text-[10.5px]"
              style={{ color: typeColor }}
            >
              {entry.type}
            </span>
            <span
              className="truncate text-[12px]"
              style={{ color: "var(--qw-fg)" }}
            >
              {entry.description}
            </span>
            {entry.detail && (
              <span
                className="ml-auto shrink-0 font-mono text-[10.5px]"
                style={{ color: "var(--qw-fg-faint)" }}
              >
                {entry.detail}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
