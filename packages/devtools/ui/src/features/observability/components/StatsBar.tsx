import type {
  Trace,
  BudgetSnapshotData,
  StatsData,
  TimeseriesBucket,
} from "@/types";
import { InlineBudgetGauge } from "./BudgetGauge";
import { ErrorGroupBar } from "./ErrorGroupBar";
import {
  formatDuration,
  formatCost,
} from "@/features/observability/lib/timeline-helpers";

export function StatsBar({
  traces,
  budgetSnapshots,
  stats,
  timeseries,
}: {
  traces: Trace[];
  budgetSnapshots: BudgetSnapshotData[];
  stats?: StatsData | null;
  timeseries?: TimeseriesBucket[];
}) {
  const successCount = traces.filter((t) => t.status === "success").length;
  const errorCount = traces.filter((t) => t.status === "error").length;
  const total = traces.length;
  const successRate =
    total > 0
      ? Math.round((successCount / (successCount + errorCount || 1)) * 100)
      : 0;
  const completed = traces.filter((t) => t.durationMs !== undefined);
  const avgDuration =
    completed.length > 0
      ? Math.round(
          completed.reduce((s, t) => s + (t.durationMs ?? 0), 0) /
            completed.length,
        )
      : 0;
  const totalCost =
    stats?.totalCost ?? traces.reduce((s, t) => s + (t.result?.cost ?? 0), 0);
  const latestBudget = budgetSnapshots.length > 0 ? budgetSnapshots[0]! : null;

  // Mini sparkline renderer
  const sparkline = (data: number[] | undefined, color: string) => {
    if (!data || data.length < 2) return null;
    const max = Math.max(...data, 1);
    const w = 48,
      h = 16;

    // Compute baseline band (mean ± 1 stddev)
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const stddev = Math.sqrt(
      data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length,
    );
    const bandTop = h - (Math.min(mean + stddev, max) / max) * h;
    const bandBottom = h - (Math.max(mean - stddev, 0) / max) * h;
    const bandHeight = bandBottom - bandTop;

    const points = data
      .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * h}`)
      .join(" ");
    return (
      <svg
        width={w}
        height={h}
        className="inline-block ml-1 align-middle opacity-60"
      >
        {bandHeight > 0 && (
          <rect
            x={0}
            y={bandTop}
            width={w}
            height={bandHeight}
            fill="#3f3f46"
            opacity={0.4}
            rx={1}
          />
        )}
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={1.2}
        />
      </svg>
    );
  };

  const execSparkline = timeseries?.map((b) => b.executions);
  const durationSparkline = timeseries?.map((b) => b.avgDurationMs);
  const costSparkline = timeseries?.map((b) => b.totalCost);

  return (
    <>
      <div className="flex items-center gap-6 bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Executions:</span>
          <span className="text-zinc-200 font-medium tabular-nums">
            {total}
          </span>
          {sparkline(execSparkline, "#a1a1aa")}
          {execSparkline &&
            execSparkline.length >= 4 &&
            (() => {
              const recent = execSparkline.slice(
                -Math.ceil(execSparkline.length / 2),
              );
              const older = execSparkline.slice(
                0,
                Math.ceil(execSparkline.length / 2),
              );
              const recentAvg =
                recent.reduce((a, b) => a + b, 0) / recent.length;
              const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
              if (olderAvg === 0) return null;
              const delta = ((recentAvg - olderAvg) / olderAvg) * 100;
              if (Math.abs(delta) < 5) return null;
              return (
                <span
                  className={`text-[10px] tabular-nums ${delta > 0 ? "text-(--devtools-ok)" : "text-(--devtools-danger)"}`}
                >
                  {delta > 0 ? "\u2191" : "\u2193"}
                  {Math.abs(delta).toFixed(0)}%
                </span>
              );
            })()}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Success:</span>
          <span
            className={`font-medium tabular-nums ${successRate >= 90 ? "text-(--devtools-ok)" : successRate >= 70 ? "text-(--devtools-warn)" : "text-(--devtools-danger)"}`}
          >
            {successRate}%
          </span>
        </div>
        {errorCount > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Errors:</span>
            <span className="text-(--devtools-danger) font-medium tabular-nums">
              {errorCount}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500">Avg:</span>
          <span className="text-zinc-200 font-medium tabular-nums">
            {avgDuration > 0 ? formatDuration(avgDuration) : "--"}
          </span>
          {sparkline(durationSparkline, "#a1a1aa")}
        </div>
        {totalCost > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Cost:</span>
            <span className="text-zinc-200 font-medium tabular-nums">
              {formatCost(totalCost)}
            </span>
            {sparkline(costSparkline, "#34d399")}
          </div>
        )}
        {stats?.semanticCacheHitRate != null && (
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-500">Semantic cache:</span>
            <span className="text-(--devtools-blue) font-medium tabular-nums">
              {(stats.semanticCacheHitRate * 100).toFixed(0)}%
            </span>
          </div>
        )}
        {latestBudget && (
          <div className="ml-auto">
            <InlineBudgetGauge budget={latestBudget} />
          </div>
        )}
      </div>
      {errorCount > 0 && <ErrorGroupBar traces={traces} />}
    </>
  );
}
