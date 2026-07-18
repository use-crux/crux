import type { RunsGroupBy, RunRow, RunsTab } from "../types";

export interface RunGroup {
  key: string;
  rows: readonly RunRow[];
}

export interface RunGroupSummary {
  totalCost: number;
  totalTokens: number;
  avgDurationMs?: number;
  failCount: number;
}

export function rowsForTab(
  rows: readonly RunRow[],
  tab: RunsTab,
): readonly RunRow[] {
  if (tab === "live") return rows.filter((run) => run.status === "running");
  if (tab === "failures") return rows.filter(isFailureStatus);
  return rows;
}

export function groupRuns(
  rows: readonly RunRow[],
  groupBy: RunsGroupBy,
): readonly RunGroup[] {
  if (groupBy === "none") return [{ key: "", rows: sortRowsNewestFirst(rows) }];
  const map = new Map<string, RunRow[]>();
  for (const run of rows) {
    const key =
      groupBy === "target"
        ? (run.target ?? "-")
        : groupBy === "primitive"
          ? run.kind
          : groupBy === "session"
            ? (run.sessionId ?? "-")
            : "-";
    const groupRows = map.get(key) ?? [];
    groupRows.push(run);
    map.set(key, groupRows);
  }
  return Array.from(map.entries())
    .map(([key, rows]) => ({ key, rows: sortRowsNewestFirst(rows) }))
    .sort((a, b) => newestStartedAt(b.rows) - newestStartedAt(a.rows));
}

export function summarizeRunGroup(rows: readonly RunRow[]): RunGroupSummary {
  let totalCost = 0;
  let totalTokens = 0;
  let totalDuration = 0;
  let durationCount = 0;
  let failCount = 0;
  for (const run of rows) {
    if (run.cost != null) totalCost += run.cost;
    if (run.tokenCount != null) totalTokens += run.tokenCount;
    if (run.durationMs != null) {
      totalDuration += run.durationMs;
      durationCount += 1;
    }
    if (isFailureStatus(run)) failCount += 1;
  }
  return {
    totalCost,
    totalTokens,
    avgDurationMs:
      durationCount > 0 ? totalDuration / durationCount : undefined,
    failCount,
  };
}

export function countRuns(rows: readonly RunRow[]) {
  return {
    total: rows.length,
    live: rows.filter((run) => run.status === "running").length,
    failures: rows.filter(isFailureStatus).length,
  };
}

export function exportableRunRows(rows: readonly RunRow[]) {
  return rows.map((run) => ({
    kind: run.kind,
    traceId: run.traceId,
    target: run.target,
    model: run.model,
    status: run.status,
    durationMs: run.durationMs,
    cost: run.cost,
    tokenCount: run.tokenCount,
    startedAt: new Date(run.startedAt).toISOString(),
  }));
}

function isFailureStatus(run: RunRow): boolean {
  return (
    run.status === "error" || run.status === "fail" || run.status === "failed"
  );
}

function sortRowsNewestFirst(rows: readonly RunRow[]): readonly RunRow[] {
  return [...rows].sort((a, b) => b.startedAt - a.startedAt);
}

function newestStartedAt(rows: readonly RunRow[]): number {
  return rows[0]?.startedAt ?? 0;
}
