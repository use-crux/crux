import { useMemo } from "react";
import type { Trace } from "@/types";
import { classifyError, type ErrorCategory } from "@/shared/lib/classify-error";

interface ErrorGroup {
  fingerprint: string;
  category: ErrorCategory;
  label: string;
  message: string;
  count: number;
  lastSeen: number;
  promptIds: Set<string>;
  retryable: boolean;
  color: string;
  bgColor: string;
}

export function ErrorGroupBar({
  traces,
  onFilterErrors,
}: {
  traces: Trace[];
  onFilterErrors?: () => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ErrorGroup>();

    for (const t of traces) {
      if (t.status !== "error" || !t.error?.message) continue;
      const cls = classifyError(t.error.message);
      // Fingerprint: category + promptId + first 50 chars of message
      const msgPrefix = t.error.message.slice(0, 50);
      const fp = `${cls.category}:${t.promptId ?? ""}:${msgPrefix}`;

      const existing = map.get(fp);
      if (existing) {
        existing.count++;
        if (t.startedAt > existing.lastSeen) existing.lastSeen = t.startedAt;
        if (t.promptId) existing.promptIds.add(t.promptId);
      } else {
        map.set(fp, {
          fingerprint: fp,
          category: cls.category,
          label: cls.label,
          message: t.error.message,
          count: 1,
          lastSeen: t.startedAt,
          promptIds: new Set(t.promptId ? [t.promptId] : []),
          retryable: cls.retryable,
          color: cls.color,
          bgColor: cls.bgColor,
        });
      }
    }

    // Sort by frequency * recency (most impactful first)
    return [...map.values()].sort((a, b) => {
      const scoreA = a.count * (1 + a.lastSeen / Date.now());
      const scoreB = b.count * (1 + b.lastSeen / Date.now());
      return scoreB - scoreA;
    });
  }, [traces]);

  if (groups.length === 0) return null;

  const topIssue = groups[0]!;
  const timeSince = Date.now() - topIssue.lastSeen;
  const timeAgo =
    timeSince < 60000
      ? "<1m ago"
      : timeSince < 3600000
        ? `${Math.floor(timeSince / 60000)}m ago`
        : `${Math.floor(timeSince / 3600000)}h ago`;

  return (
    <div className="flex items-center gap-3 bg-(--devtools-danger-soft) border border-(--devtools-danger-soft) rounded-lg px-3 py-1.5 text-xs">
      <span className="text-(--devtools-danger) font-medium shrink-0">
        Top issue:
      </span>
      <span
        className={`px-1.5 py-0.5 rounded border text-[10px] shrink-0 ${topIssue.bgColor} ${topIssue.color}`}
      >
        {topIssue.label}
      </span>
      <span className="text-zinc-400 truncate">
        {topIssue.message.slice(0, 80)}
        {topIssue.message.length > 80 ? "..." : ""}
      </span>
      <span className="text-(--devtools-danger) tabular-nums shrink-0">
        {topIssue.count}x
      </span>
      {topIssue.promptIds.size > 0 && (
        <span className="text-zinc-600 shrink-0">
          {topIssue.promptIds.size} prompt
          {topIssue.promptIds.size !== 1 ? "s" : ""}
        </span>
      )}
      <span className="text-zinc-600 shrink-0">{timeAgo}</span>
      {groups.length > 1 && (
        <button
          onClick={onFilterErrors}
          className="text-[10px] text-zinc-500 hover:text-zinc-300 shrink-0 ml-auto"
        >
          +{groups.length - 1} more
        </button>
      )}
    </div>
  );
}
