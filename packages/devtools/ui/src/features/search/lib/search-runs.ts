import type { ObservabilityRunSummary } from "@/types";

const MAX_PER_CATEGORY = 5;

export interface RunSearchResult {
  category: "traces";
  id: string;
  label: string;
  meta: string;
  /** Nav target for run detail — keyed by logical run id. */
  nav: { view: "run-detail"; traceId: string };
}

function matches(
  query: string,
  ...fields: (string | undefined | null)[]
): boolean {
  const q = query.toLowerCase();
  return fields.some((f) => f != null && f.toLowerCase().includes(q));
}

/**
 * Match runs for Global Search against one page of the revisioned Runs read
 * model. Callers must pass rows from `useObservabilityRunsPage` /
 * `listRunsPage` — not a second bare-array list source.
 */
export function searchRuns(
  runs: readonly ObservabilityRunSummary[],
  query: string,
): RunSearchResult[] {
  const results: RunSearchResult[] = [];
  for (const run of runs) {
    if (results.length >= MAX_PER_CATEGORY) break;
    if (
      matches(
        query,
        run.operationId,
        run.runId,
        run.traceId,
        run.promptId,
        run.model,
        run.name,
        run.rootPrimitive,
      )
    ) {
      results.push({
        category: "traces",
        id: run.operationId,
        label: run.promptId || run.name || run.operationId.slice(0, 12),
        meta: `${run.model || run.rootPrimitive} · ${run.status}`,
        nav: { view: "run-detail", traceId: run.operationId },
      });
    }
  }
  return results;
}
