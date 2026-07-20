import { useDeferredValue, useMemo } from "react";
import { useObservabilityRunsPage } from "@/features/observability/hooks/useObservabilityGraph";
import { useInspectRuns } from "@/shared/hooks/useInspectApi";
import type { RunRow, RunsFilters } from "../types";
import {
  annotateRunRowWithInspect,
  inspectAnnotationsByRunId,
  rowFromRunSummary,
  runsPageOptionsFromFilters,
} from "../lib/run-mappers";

export interface UseRunsResult {
  allRows: readonly RunRow[];
  distinctTargets: readonly string[];
  distinctModels: readonly string[];
  /** True while the canonical Runs page is fetching. Lets the caller
   *  distinguish "loading the first batch" from "fetched, empty". */
  loading: boolean;
  /** True while the deferred filter inputs are still settling. UI can
   *  dim the table to communicate that results haven't caught up to the
   *  typed search yet. */
  isFilterPending: boolean;
}

/**
 * The Runs feature's one row source (binding spec 04 §3): the joined,
 * revisioned `/api/observability/runs/page` read model, decorated — never
 * merged — with Inspect's annotation-only score and diagnostic metadata.
 * Status and time-range filters run server-side; `target`/`model`/`search`
 * are client-side refinement filters over that one
 * bounded page, not a second independently-filtered row source.
 */
export function useRuns(filters: RunsFilters): UseRunsResult {
  // Defer the filter object so the local re-filter happens in a
  // transition rather than blocking the input. The server-side query
  // still uses the live filter (so the URL and server stay authoritative);
  // only the client-side refinement-filter pipeline reads the deferred view.
  const deferredFilters = useDeferredValue(filters);
  const isFilterPending = filters !== deferredFilters;

  const pageOptions = useMemo(
    () => runsPageOptionsFromFilters(filters),
    [filters],
  );
  const runsPage = useObservabilityRunsPage(pageOptions);
  // Inspect is an annotation source only — its own filters would reintroduce
  // a second, independently-filtered row set, so it's fetched unfiltered and
  // joined onto the canonical rows below by operationId.
  const inspectRuns = useInspectRuns();
  const inspectByRunId = useMemo(
    () => inspectAnnotationsByRunId(inspectRuns.data ?? []),
    [inspectRuns.data],
  );

  const allRows = useMemo<readonly RunRow[]>(() => {
    const rows = (runsPage.page?.rows ?? []).map((summary) =>
      annotateRunRowWithInspect(
        rowFromRunSummary(summary),
        inspectByRunId.get(summary.operationId),
      ),
    );

    let filtered: readonly RunRow[] = rows;
    if (deferredFilters.target && deferredFilters.target.length > 0) {
      const targets = new Set(deferredFilters.target);
      filtered = filtered.filter((run) => targets.has(run.target));
    }
    if (deferredFilters.model && deferredFilters.model.length > 0) {
      const models = new Set(deferredFilters.model);
      filtered = filtered.filter(
        (run) => run.model != null && models.has(run.model),
      );
    }
    if (deferredFilters.search?.trim()) {
      const query = deferredFilters.search.trim().toLowerCase();
      filtered = filtered.filter((run) =>
        `${run.operationId} ${run.target ?? ""} ${run.model ?? ""}`
          .toLowerCase()
          .includes(query),
      );
    }
    return filtered;
  }, [runsPage.page, inspectByRunId, deferredFilters]);

  const distinctTargets = useMemo(() => {
    const values = new Set<string>();
    for (const run of runsPage.page?.rows ?? []) {
      const name = run.name || run.rootPrimitive || run.operationId;
      if (name) values.add(name);
    }
    return Array.from(values).sort().slice(0, 50);
  }, [runsPage.page]);

  const distinctModels = useMemo(() => {
    const values = new Set<string>();
    for (const run of runsPage.page?.rows ?? []) {
      if (run.model) values.add(run.model);
    }
    return Array.from(values).sort().slice(0, 50);
  }, [runsPage.page]);

  return {
    allRows,
    distinctTargets,
    distinctModels,
    loading: runsPage.loading,
    isFilterPending,
  };
}
