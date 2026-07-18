/**
 * TanStack Query hooks for Library v2 endpoints (Memory / Workspaces /
 * Plans). Contract documented in
 * `packages/devtools/LIBRARY_V2_BACKEND_HANDOFF.md`.
 *
 * Pattern matches `useInspectApi.ts`: every hook returns the legacy
 * `{ data, loading, error, reload }` shape via `useAdapted()` so
 * screens don't depend on raw Query internals. WS invalidation is
 * routed by prefix in `useDevtools.ts` (MemoryStoreEvent → qk.memory,
 * WorkspaceEvent → qk.workspaces, PlanEvent → qk.plans).
 */

import { useCallback } from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { libraryService } from "@/shared/services/library";
import type {
  MemoryStore,
  MemoryStoreDetail,
  MemoryOperationRecord,
  Workspace,
  WorkspaceDetail,
  WorkspaceFileDetail,
  PlanSummary,
  PlanDetail,
} from "@/types";

export interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => void;
}

function useAdapted<T>(
  query: UseQueryResult<T, Error>,
  invalidateKey: readonly unknown[],
): FetchState<T> {
  const client = useQueryClient();
  const keyHash = invalidateKey.join("|");
  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: invalidateKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, keyHash]);
  return {
    data: query.data ?? null,
    loading: query.isPending || query.isFetching,
    error: query.error ?? null,
    reload,
  };
}

// ─── Memory ──────────────────────────────────────────────────────────

export function useMemoryStores(): FetchState<readonly MemoryStore[]> {
  const key = qk.memory.stores();
  const q = useQuery<readonly MemoryStore[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.memoryStores(signal),
  });
  return useAdapted(q, key);
}

export function useMemoryStore(
  storeId: string | null | undefined,
): FetchState<MemoryStoreDetail> {
  const key = qk.memory.store(storeId);
  const q = useQuery<MemoryStoreDetail, Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.memoryStore(storeId ?? "", signal),
    enabled: Boolean(storeId),
  });
  return useAdapted(q, key);
}

/** Fetch details for many stores in parallel — used by the Memory
 * overview to compute the cross-store Operation history. Each store
 * detail goes through the same Query cache as `useMemoryStore`, so
 * navigating to the detail page is a cache hit. */
export function useMemoryStoreDetails(
  storeIds: readonly string[],
): readonly UseQueryResult<MemoryStoreDetail, Error>[] {
  return useQueries({
    queries: storeIds.map((id) => ({
      queryKey: qk.memory.store(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        libraryService.memoryStore(id, signal),
      enabled: Boolean(id),
    })),
  });
}

export function useMemoryOperations(
  params: {
    since?: number;
    until?: number;
    limit?: number;
  } = {},
): FetchState<readonly MemoryOperationRecord[]> {
  const key = qk.memory.operations(params.since, params.until, params.limit);
  const q = useQuery<readonly MemoryOperationRecord[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.memoryOperations(params, signal),
  });
  return useAdapted(q, key);
}

// ─── Workspaces ──────────────────────────────────────────────────────

export function useWorkspaces(): FetchState<readonly Workspace[]> {
  const key = qk.workspaces.list();
  const q = useQuery<readonly Workspace[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.workspaces(signal),
  });
  return useAdapted(q, key);
}

/** Parallel-fetch detail for many workspaces. Used by the overview's
 * cross-workspace audit trail (`recentOps` merged across workspaces).
 * Cache is shared with `useWorkspace` so detail-page navigation is a
 * cache hit. */
export function useWorkspaceDetails(
  workspaceIds: readonly string[],
): readonly UseQueryResult<WorkspaceDetail, Error>[] {
  return useQueries({
    queries: workspaceIds.map((id) => ({
      queryKey: qk.workspaces.workspace(id),
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        libraryService.workspace(id, signal),
      enabled: Boolean(id),
    })),
  });
}

export function useWorkspace(
  workspaceId: string | null | undefined,
): FetchState<WorkspaceDetail> {
  const key = qk.workspaces.workspace(workspaceId);
  const q = useQuery<WorkspaceDetail, Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      libraryService.workspace(workspaceId ?? "", signal),
    enabled: Boolean(workspaceId),
  });
  return useAdapted(q, key);
}

export function useWorkspaceFile(
  workspaceId: string | null | undefined,
  filePath: string | null | undefined,
): FetchState<WorkspaceFileDetail> {
  const key = qk.workspaces.file(workspaceId, filePath);
  const q = useQuery<WorkspaceFileDetail, Error>({
    queryKey: key,
    queryFn: ({ signal }) =>
      libraryService.workspaceFile(workspaceId ?? "", filePath ?? "", signal),
    enabled: Boolean(workspaceId && filePath),
  });
  return useAdapted(q, key);
}

// ─── Plans ───────────────────────────────────────────────────────────

export function usePlans(): FetchState<readonly PlanSummary[]> {
  const key = qk.plans.list();
  const q = useQuery<readonly PlanSummary[], Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.plans(signal),
  });
  return useAdapted(q, key);
}

export function usePlan(
  planId: string | null | undefined,
): FetchState<PlanDetail> {
  const key = qk.plans.plan(planId);
  const q = useQuery<PlanDetail, Error>({
    queryKey: key,
    queryFn: ({ signal }) => libraryService.plan(planId ?? "", signal),
    enabled: Boolean(planId),
  });
  return useAdapted(q, key);
}

// ─── Suspense-enabled variants ───────────────────────────────────────
//
// See useInspectApi.ts for the rationale. These all assume a non-null
// id (the consumer is responsible for ensuring the id exists before
// calling — the boundary should not mount otherwise).

export function useMemoryStoresSuspense() {
  return useSuspenseQuery({
    queryKey: qk.memory.stores(),
    queryFn: ({ signal }) => libraryService.memoryStores(signal),
  }).data;
}

export function useMemoryStoreSuspense(storeId: string) {
  return useSuspenseQuery({
    queryKey: qk.memory.store(storeId),
    queryFn: ({ signal }) => libraryService.memoryStore(storeId, signal),
  }).data;
}

export function useWorkspacesSuspense() {
  return useSuspenseQuery({
    queryKey: qk.workspaces.list(),
    queryFn: ({ signal }) => libraryService.workspaces(signal),
  }).data;
}

export function useWorkspaceSuspense(workspaceId: string) {
  return useSuspenseQuery({
    queryKey: qk.workspaces.workspace(workspaceId),
    queryFn: ({ signal }) => libraryService.workspace(workspaceId, signal),
  }).data;
}

export function usePlansSuspense() {
  return useSuspenseQuery({
    queryKey: qk.plans.list(),
    queryFn: ({ signal }) => libraryService.plans(signal),
  }).data;
}

export function usePlanSuspense(planId: string) {
  return useSuspenseQuery({
    queryKey: qk.plans.plan(planId),
    queryFn: ({ signal }) => libraryService.plan(planId, signal),
  }).data;
}
