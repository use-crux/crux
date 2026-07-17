/**
 * Prefetch-on-hover helpers.
 *
 * Bind to a row's `onMouseEnter` / `onFocus` so navigating in feels
 * instant — by the time the click lands, the detail query is already
 * hot in the TanStack Query cache.
 *
 * `staleTime` defaults to 10s: we only want to skip the prefetch if the
 * cache is already fresh enough that a refetch wouldn't help anyway.
 * 10s is short enough that hovering after a server-side update still
 * triggers a refresh.
 */

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { inspectService } from "@/shared/services/inspect";
import { libraryService } from "@/shared/services/library";
import { observabilityService } from "@/features/observability/services/observability";

const HOVER_STALE_MS = 10_000;

/** Prefetch the canonical run detail + the quality run detail in
 *  parallel. Call from a runs-list row's `onMouseEnter` / `onFocus`. */
export function usePrefetchRunDetail() {
  const client = useQueryClient();
  return useCallback(
    (traceId: string) => {
      if (!traceId) return;
      void client.prefetchQuery({
        queryKey: qk.inspect.run(traceId),
        queryFn: ({ signal }) => inspectService.runDetail(traceId, signal),
        staleTime: HOVER_STALE_MS,
      });
      void client.prefetchQuery({
        queryKey: qk.observability.run(traceId),
        queryFn: ({ signal }) => observabilityService.getRun(traceId, signal),
        staleTime: HOVER_STALE_MS,
      });
    },
    [client],
  );
}

/** Prefetch a memory store detail. */
export function usePrefetchMemoryStore() {
  const client = useQueryClient();
  return useCallback(
    (storeId: string) => {
      if (!storeId) return;
      void client.prefetchQuery({
        queryKey: qk.memory.store(storeId),
        queryFn: ({ signal }) => libraryService.memoryStore(storeId, signal),
        staleTime: HOVER_STALE_MS,
      });
    },
    [client],
  );
}

/** Prefetch a workspace detail. */
export function usePrefetchWorkspace() {
  const client = useQueryClient();
  return useCallback(
    (workspaceId: string) => {
      if (!workspaceId) return;
      void client.prefetchQuery({
        queryKey: qk.workspaces.workspace(workspaceId),
        queryFn: ({ signal }) => libraryService.workspace(workspaceId, signal),
        staleTime: HOVER_STALE_MS,
      });
    },
    [client],
  );
}

/** Prefetch a plan detail. */
export function usePrefetchPlan() {
  const client = useQueryClient();
  return useCallback(
    (planId: string) => {
      if (!planId) return;
      void client.prefetchQuery({
        queryKey: qk.plans.plan(planId),
        queryFn: ({ signal }) => libraryService.plan(planId, signal),
        staleTime: HOVER_STALE_MS,
      });
    },
    [client],
  );
}
