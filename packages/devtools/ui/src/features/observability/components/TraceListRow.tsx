import { useState } from "react";
import type { Trace, AgentEventData } from "@/types";
import { useResolvedSource } from "@/shared/hooks/useResolvedSource";
import { Shimmer } from "@/shared/components/ai-elements/shimmer";
import { AnomalyBadge } from "@/features/observability/components/AnomalyBadge";
import { fmt } from "@/shared/components/ui-atoms";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
import {
  formatTime,
  formatDuration,
  formatCost,
  ROLE_LABELS,
  ROLE_COLORS,
  ROLE_LINE_COLORS,
  ROLE_DOT_COLORS,
} from "@/features/observability/lib/timeline-helpers";
import { classifyError } from "@/shared/lib/classify-error";

// ─────────────────────────────────────────────────────────────────
// Hover Preview
// ─────────────────────────────────────────────────────────────────

function TraceHoverPreview({ trace }: { trace: Trace }) {
  const usage = trace.result?.usage;
  return (
    <div className="space-y-1 text-xs">
      <div className="font-medium text-zinc-200">
        {trace.promptId ?? "unnamed"}
      </div>
      <div className="flex items-center gap-3 text-zinc-400">
        <span>{trace.model.replace(/^[^/]+\//, "")}</span>
        <span>{formatDuration(trace.durationMs)}</span>
        <span
          className={
            trace.status === "error"
              ? "text-(--devtools-danger)"
              : trace.status === "running"
                ? "text-(--devtools-blue)"
                : "text-(--devtools-ok)"
          }
        >
          {trace.status}
        </span>
      </div>
      {usage && (
        <div className="flex items-center gap-3 text-zinc-500">
          {usage.inputTokens != null && (
            <span>In: {usage.inputTokens.toLocaleString()}</span>
          )}
          {usage.outputTokens != null && (
            <span>Out: {usage.outputTokens.toLocaleString()}</span>
          )}
          {trace.result?.cost != null && (
            <span className="text-(--devtools-ok)">
              {formatCost(trace.result.cost)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Inline agent event indicators
// ─────────────────────────────────────────────────────────────────

export function InlineHandoff({ event }: { event: AgentEventData }) {
  // Handoff fields live on HandoffPrepareEvent — `_kind` is an intersection,
  // not a discriminant, so narrow via structural cast.
  const d = event as Partial<{
    fromAgent: string;
    toAgent: string;
    summary: string;
  }>;
  const from = d.fromAgent ?? "?";
  const to = d.toAgent ?? "?";
  return (
    <div className="flex items-center gap-2 text-[10px] py-1 px-2">
      <span className="w-1.5 h-1.5 rounded-full bg-(--devtools-crux) shrink-0" />
      <span className="text-(--devtools-crux) font-mono">handoff</span>
      <span className="text-zinc-400">{from}</span>
      <svg
        className="w-3 h-3 text-(--devtools-crux)"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 7l5 5m0 0l-5 5m5-5H6"
        />
      </svg>
      <span className="text-zinc-400">{to}</span>
      {d.summary && <span className="text-zinc-600 truncate">{d.summary}</span>}
    </div>
  );
}

export function InlineBlackboard({ event }: { event: AgentEventData }) {
  // Blackboard fields live on BlackboardUpdateEvent — see InlineHandoff for narrowing notes.
  const d = event as Partial<{ boardId: string; fieldsChanged: string[] }>;
  return (
    <div className="flex items-center gap-2 text-[10px] py-0.5 px-2">
      <span className="w-1.5 h-1.5 rounded-sm bg-(--devtools-crux) shrink-0" />
      <span className="text-(--devtools-crux) font-mono">board</span>
      <span className="text-zinc-500">{d.boardId}</span>
      {d.fieldsChanged && (
        <span className="text-zinc-600">[{d.fieldsChanged.join(", ")}]</span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Trace list row
// ─────────────────────────────────────────────────────────────────

export function TraceListRow({
  trace,
  isSelected,
  onSelect,
  judgeScore,
  flowBreadcrumb,
  isSlow,
  costDeviation,
  securityCount,
  nestLevel = 0,
  showTreeLines = false,
  isLast = false,
}: {
  trace: Trace;
  isSelected: boolean;
  onSelect: (traceId: string) => void;
  judgeScore?: number;
  flowBreadcrumb?: string;
  isSlow?: boolean;
  costDeviation?: number;
  securityCount?: number;
  nestLevel?: number;
  showTreeLines?: boolean;
  isLast?: boolean;
}) {
  const usage = trace.result?.usage;
  const statusIcon =
    trace.status === "success"
      ? "\u2713"
      : trace.status === "error"
        ? "\u2717"
        : "\u25CF";
  const statusColor =
    trace.status === "success"
      ? "text-(--devtools-ok)"
      : trace.status === "error"
        ? "text-(--devtools-danger)"
        : "text-(--devtools-blue)";

  const resolvedSource = useResolvedSource(trace.source);

  const roleLabel = trace.role ? (ROLE_LABELS[trace.role] ?? trace.role) : null;
  const roleColor = trace.role
    ? (ROLE_COLORS[trace.role] ?? "text-zinc-500")
    : "text-zinc-500";
  const dotColor = trace.role
    ? (ROLE_DOT_COLORS[trace.role] ?? "bg-zinc-600")
    : "bg-zinc-600";
  const lineColor = trace.role
    ? (ROLE_LINE_COLORS[trace.role] ?? "border-zinc-700")
    : "border-zinc-700";
  const shortModel =
    trace.model !== "resolve-only" ? trace.model.replace(/^[^/]+\//, "") : null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="relative">
          {/* Tree connecting lines */}
          {showTreeLines && nestLevel > 0 && (
            <div
              className="absolute left-0 top-0 bottom-0"
              style={{ width: nestLevel * 20 }}
            >
              <div
                className={`absolute border-l ${lineColor}`}
                style={{
                  left: (nestLevel - 1) * 20 + 9,
                  top: 0,
                  bottom: isLast ? "50%" : 0,
                }}
              />
              <div
                className={`absolute border-t ${lineColor}`}
                style={{
                  left: (nestLevel - 1) * 20 + 9,
                  top: "50%",
                  width: 11,
                }}
              />
            </div>
          )}

          <button
            onClick={() => onSelect(trace.traceId)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 transition-colors text-left text-[11px] rounded ${
              isSelected
                ? "bg-zinc-800 ring-1 ring-zinc-700"
                : "hover:bg-zinc-800/50"
            }`}
            style={{ paddingLeft: showTreeLines ? nestLevel * 20 + 12 : 12 }}
          >
            {showTreeLines && nestLevel > 0 && (
              <span
                className={`w-2 h-2 rounded-full ${dotColor} shrink-0 relative z-10`}
              />
            )}
            {(!showTreeLines || nestLevel === 0) && (
              <span
                className={`font-medium ${statusColor}${trace.status === "running" ? " animate-running-pulse" : ""}`}
              >
                {statusIcon}
              </span>
            )}
            <span className="text-zinc-500 tabular-nums w-16 shrink-0">
              {formatTime(trace.startedAt)}
            </span>
            {roleLabel && (
              <span
                className={`${roleColor} w-14 shrink-0 font-mono text-[10px]`}
              >
                {roleLabel}
              </span>
            )}
            <span className="font-mono text-zinc-200 truncate">
              {trace.promptId ?? "unnamed"}
            </span>
            {flowBreadcrumb && (
              <span className="text-zinc-600 text-[10px] truncate max-w-[100px]">
                {flowBreadcrumb}
              </span>
            )}
            {shortModel && (
              <span className="text-zinc-600 truncate text-[10px] max-w-[100px]">
                {shortModel}
              </span>
            )}
            {(resolvedSource ?? trace.source) &&
              (() => {
                const src = resolvedSource ?? trace.source!;
                return (
                  <span
                    className={`truncate text-[10px] max-w-[140px] font-mono ${resolvedSource?.resolved ? "text-zinc-500" : "text-zinc-600"}`}
                    title={`${src.file}:${src.line}`}
                  >
                    {src.file.replace(/^.*\//, "")}:{src.line}
                  </span>
                );
              })()}
            {/* Judge score dot */}
            {judgeScore != null && (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  judgeScore >= 0.7
                    ? "bg-(--devtools-ok)"
                    : judgeScore >= 0.5
                      ? "bg-(--devtools-warn)"
                      : "bg-(--devtools-danger)"
                }`}
                title={`Judge: ${judgeScore.toFixed(2)}`}
              />
            )}
            {/* TTFT badge */}
            {trace.streaming?.ttftMs != null && (
              <span
                className={`text-[10px] tabular-nums ${trace.streaming.ttftMs < 200 ? "text-(--devtools-ok)" : trace.streaming.ttftMs < 500 ? "text-(--devtools-warn)" : "text-(--devtools-danger)"}`}
                title={`TTFT: ${trace.streaming.ttftMs}ms`}
              >
                {trace.streaming.ttftMs}ms
              </span>
            )}
            {/* Slow indicator */}
            {isSlow && (
              <span
                className="text-(--devtools-warn) text-[10px]"
                title="Slow (P90+)"
              >
                {"\uD83D\uDD25"}
              </span>
            )}
            {showTreeLines && nestLevel > 0 && (
              <span className={`${statusColor} text-[10px]`}>{statusIcon}</span>
            )}
            <span
              className={`${statusColor} tabular-nums ml-auto flex items-center gap-1.5`}
            >
              {trace.status === "running" ? (
                trace.streamProgress ? (
                  <>
                    {trace.streamProgress.ttftMs != null && (
                      <span
                        className={`text-[10px] ${trace.streamProgress.ttftMs < 200 ? "text-(--devtools-ok)" : trace.streamProgress.ttftMs < 500 ? "text-(--devtools-warn)" : "text-(--devtools-danger)"}`}
                      >
                        {trace.streamProgress.ttftMs}ms
                      </span>
                    )}
                    <span className="text-[10px] text-zinc-500">
                      {trace.streamProgress.chunksReceived}ch
                    </span>
                    <span className="text-[10px] text-(--devtools-blue) tabular-nums">
                      {(trace.streamProgress.elapsedMs / 1000).toFixed(1)}s
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-(--devtools-blue) animate-pulse" />
                  </>
                ) : (
                  <Shimmer
                    as="span"
                    className="text-xs text-(--devtools-blue)"
                    duration={2}
                  >
                    Running...
                  </Shimmer>
                )
              ) : (
                formatDuration(trace.durationMs)
              )}
            </span>
            {usage?.inputTokens != null && usage?.outputTokens != null ? (
              <span
                className="text-zinc-600 tabular-nums text-[10px] w-20 text-right"
                title={`In: ${usage.inputTokens.toLocaleString()} · Out: ${usage.outputTokens.toLocaleString()}`}
              >
                {fmt(usage.inputTokens, "tok")}→{fmt(usage.outputTokens, "tok")}
              </span>
            ) : usage?.totalTokens ? (
              <span className="text-zinc-600 tabular-nums w-14 text-right">
                {fmt(usage.totalTokens, "tok")}
              </span>
            ) : null}
            {trace.result?.cost != null && trace.result.cost > 0 && (
              <span className="text-(--devtools-ok) tabular-nums text-[10px]">
                {formatCost(trace.result.cost)}
              </span>
            )}
            {/* Fallback badge */}
            {trace.fallback && (
              <span
                className="text-[9px] px-1 py-0.5 rounded border shrink-0 text-(--devtools-warn) bg-(--devtools-warn-soft) border-(--devtools-warn-soft)"
                title={`Fallback: ${trace.fallback.attempts} attempts, failed: ${trace.fallback.failedModels.join(", ")}`}
              >
                fallback {trace.fallback.attempts}x
              </span>
            )}
            {/* Security warning badge */}
            {securityCount != null && securityCount > 0 && (
              <span
                className="inline-flex items-center gap-0.5 rounded-full px-1 py-0.5 text-[9px] font-medium text-(--devtools-danger) bg-(--devtools-danger-soft) border border-(--devtools-danger-soft) shrink-0"
                title={`${securityCount} security warning${securityCount > 1 ? "s" : ""}`}
              >
                {"\uD83D\uDEE1\uFE0F"}
                {securityCount}
              </span>
            )}
            {/* Cost anomaly badge */}
            {costDeviation != null && Math.abs(costDeviation) > 0.5 && (
              <AnomalyBadge deviation={costDeviation} type="cost" />
            )}
            {/* Error classification badge */}
            {trace.status === "error" &&
              trace.error?.message &&
              (() => {
                const cls = classifyError(trace.error!.message);
                return (
                  <span
                    className={`text-[9px] px-1 py-0.5 rounded border shrink-0 ${cls.bgColor} ${cls.color}`}
                    title={trace.error!.message}
                  >
                    {cls.label}
                    {cls.retryable ? " \u21bb" : ""}
                  </span>
                );
              })()}
          </button>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="bg-zinc-900 border-zinc-700 p-3">
        <TraceHoverPreview trace={trace} />
      </TooltipContent>
    </Tooltip>
  );
}
