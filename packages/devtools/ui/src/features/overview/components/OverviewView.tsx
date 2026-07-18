/** Inspect overview for recent run health and actionable insights. */

import * as React from "react";
import { useNavigation } from "@/app/navigation/useNavigation";
import { SkeletonKpiStrip } from "@/shared/components/Skeleton";
import {
  useInspectInsights,
  useInspectOverview,
} from "@/shared/hooks/useInspectApi";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { FilterButton } from "@/devtools/shell/FilterPopover";
import { Icon } from "@/devtools/shell/Icon";
import { Btn, Chip, Kpi } from "@/devtools/shell/primitives";

const severityRank = { high: 0, medium: 1, low: 2 } as const;

export function OverviewView() {
  const { navigate } = useNavigation();
  const [timeWindow, setTimeWindow] = React.useState<
    "all" | "24h" | "7d" | "30d"
  >("all");
  const { data: overview, loading } = useInspectOverview(timeWindow);
  const { data: insights } = useInspectInsights();

  const openInsights = React.useMemo(
    () =>
      (insights ?? [])
        .filter((insight) => insight.status === "open")
        .slice()
        .sort(
          (left, right) =>
            severityRank[left.severity] - severityRank[right.severity],
        )
        .slice(0, 6),
    [insights],
  );

  return (
    <DevtoolsShell
      breadcrumb="Inspect / Overview"
      title="Runtime health at a glance"
      subtitle={
        timeWindow === "all" ? "All retained runs" : `Last ${timeWindow}`
      }
      actions={
        <>
          <FilterButton
            icon="clock"
            title="Time window"
            value={timeWindow}
            noneValue="all"
            options={[
              { value: "all", label: "All time" },
              { value: "24h", label: "Last 24h" },
              { value: "7d", label: "Last 7d" },
              { value: "30d", label: "Last 30d" },
            ]}
            onChange={(value) =>
              setTimeWindow(value as "all" | "24h" | "7d" | "30d")
            }
          />
          <Btn
            icon={<Icon name="trace" size={13} />}
            onClick={() => navigate({ view: "runs" })}
          >
            Open runs
          </Btn>
        </>
      }
    >
      <div className="px-8 pb-10 pt-6">
        {loading && !overview ? (
          <SkeletonKpiStrip count={4} />
        ) : (
          <div className="mb-[22px] grid grid-cols-4 gap-3">
            <Kpi
              label="Pass rate"
              value={
                overview?.passRate == null
                  ? "—"
                  : `${Math.round(overview.passRate * 100)}%`
              }
              trend={overview?.passRateSpark}
              sublabel="selected window"
            />
            <Kpi
              label="Cost"
              value={overview ? `$${overview.totalCost.toFixed(2)}` : "—"}
              trend={overview?.costSpark}
              sublabel={
                overview?.costPer100Runs == null
                  ? undefined
                  : `$${overview.costPer100Runs.toFixed(2)} / 100 runs`
              }
            />
            <Kpi
              label="P50 latency"
              value={
                overview?.p50LatencyMs == null
                  ? "—"
                  : `${(overview.p50LatencyMs / 1000).toFixed(1)}s`
              }
              trend={overview?.latencySpark}
              sublabel={
                overview?.p95LatencyMs == null
                  ? undefined
                  : `P95 ${(overview.p95LatencyMs / 1000).toFixed(1)}s`
              }
            />
            <Kpi
              label="Runs"
              value={overview ? String(overview.runCount) : "—"}
              sublabel={`${openInsights.length} actionable insights shown`}
            />
          </div>
        )}

        <section
          className="overflow-hidden rounded-[12px]"
          style={{
            background: "var(--devtools-bg-elev)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          <header
            className="flex items-center gap-2.5 px-[18px] py-3"
            style={{ borderBottom: "1px solid var(--devtools-border)" }}
          >
            <Icon name="sparkle" size={14} color="var(--devtools-crux)" />
            <span className="text-[13px] font-semibold">Needs attention</span>
            <span
              className="ml-auto font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              severity first
            </span>
          </header>

          {openInsights.length === 0 ? (
            <div
              className="px-[18px] py-10 text-center text-[12.5px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              Nothing needs attention.
            </div>
          ) : (
            openInsights.map((insight, index) => (
              <button
                key={insight.insightId}
                className="flex w-full items-center gap-3 px-[18px] py-3 text-left"
                style={{
                  borderTop:
                    index === 0
                      ? undefined
                      : "1px solid var(--devtools-border)",
                }}
                onClick={() =>
                  navigate({ view: "insights", insightId: insight.insightId })
                }
              >
                <Chip
                  tone={
                    insight.severity === "high"
                      ? "danger"
                      : insight.severity === "medium"
                        ? "warn"
                        : "iris"
                  }
                >
                  {insight.severity}
                </Chip>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[12.5px] font-medium">
                    {insight.title}
                  </strong>
                  <span
                    className="block truncate text-[11.5px]"
                    style={{ color: "var(--devtools-fg-muted)" }}
                  >
                    {insight.summary}
                  </span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            ))
          )}
        </section>
      </div>
    </DevtoolsShell>
  );
}
