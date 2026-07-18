/** TanStack Query adapters for retained runtime inspection read models. */

import {
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { qk } from "@/shared/query/queryClient";
import {
  inspectService,
  type InspectRunsOptions,
} from "@/shared/services/inspect";
import type {
  InspectInsightRecord,
  InspectInsightSilence,
  InspectOverviewRecord,
  InspectRunDetailRecord,
  InspectRunRecord,
} from "@/types";

export type { InspectRunsOptions } from "@/shared/services/inspect";

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
  const reload = useCallback(() => {
    void client.invalidateQueries({ queryKey: invalidateKey });
  }, [client, invalidateKey]);
  return {
    data: query.data ?? null,
    loading: query.isPending || query.isFetching,
    error: query.error ?? null,
    reload,
  };
}

export function useInspectOverview(
  window = "all",
): FetchState<InspectOverviewRecord> {
  const key = qk.inspect.overview(window);
  return useAdapted(
    useQuery({
      queryKey: key,
      queryFn: ({ signal }) => inspectService.overview(window, signal),
    }),
    key,
  );
}

function stableRunsOptions(opts?: InspectRunsOptions) {
  return {
    status: opts?.status?.join(",") ?? "",
    target: opts?.target?.join(",") ?? "",
    kind: opts?.kind?.join(",") ?? "",
    model: opts?.model?.join(",") ?? "",
    session: opts?.session?.join(",") ?? "",
    primitive: opts?.primitive?.join(",") ?? "",
    since: opts?.since,
    until: opts?.until,
    search: opts?.search,
    sort: opts?.sort,
    order: opts?.order,
    limit: opts?.limit,
    offset: opts?.offset,
  };
}

export function useInspectRuns(
  opts?: InspectRunsOptions,
): FetchState<readonly InspectRunRecord[]> {
  const stable = useMemo(
    () => stableRunsOptions(opts),
    [
      opts?.status,
      opts?.target,
      opts?.kind,
      opts?.model,
      opts?.session,
      opts?.primitive,
      opts?.since,
      opts?.until,
      opts?.search,
      opts?.sort,
      opts?.order,
      opts?.limit,
      opts?.offset,
    ],
  );
  const key = qk.inspect.runs(stable);
  return useAdapted(
    useQuery({
      queryKey: key,
      queryFn: ({ signal }) => inspectService.runs(opts, signal),
    }),
    key,
  );
}

function isTerminal(status: string | undefined): boolean {
  return [
    "success",
    "ok",
    "error",
    "failed",
    "cancelled",
    "suspended",
    "blocked",
    "skipped",
    "incomplete",
    "stale",
  ].includes(status ?? "");
}

function runDetailRefetchInterval(query: {
  state: {
    data?: InspectRunDetailRecord | null;
    dataUpdatedAt: number;
  };
}): number | false {
  if (query.state.data === null) return false;
  const status =
    query.state.data?.run?.status ?? query.state.data?.trace?.status;
  if (!isTerminal(status)) return 1_000;
  return Date.now() - query.state.dataUpdatedAt < 30_000 ? 5_000 : false;
}

export function useInspectRunDetail(
  traceId: string | null | undefined,
): FetchState<InspectRunDetailRecord | null> {
  const key = qk.inspect.run(traceId);
  return useAdapted(
    useQuery({
      queryKey: key,
      queryFn: ({ signal }) => inspectService.runDetail(traceId ?? "", signal),
      enabled: Boolean(traceId),
      refetchInterval: runDetailRefetchInterval,
    }),
    key,
  );
}

export function useInspectInsights(): FetchState<
  readonly InspectInsightRecord[]
> {
  const key = qk.inspect.insights();
  return useAdapted(
    useQuery({
      queryKey: key,
      queryFn: ({ signal }) => inspectService.insights(signal),
    }),
    key,
  );
}

export function useInspectInsightSilences(opts?: {
  includeDeleted?: boolean;
}): FetchState<readonly InspectInsightSilence[]> {
  const includeDeleted = opts?.includeDeleted ?? false;
  const key = qk.inspect.insightSilences({ includeDeleted });
  return useAdapted(
    useQuery({
      queryKey: key,
      queryFn: ({ signal }) =>
        inspectService.insightSilences(includeDeleted, signal),
    }),
    key,
  );
}

export function useInspectOverviewSuspense() {
  return useSuspenseQuery({
    queryKey: qk.inspect.overview("all"),
    queryFn: ({ signal }) => inspectService.overview("all", signal),
  }).data;
}

export function useInspectRunsSuspense(opts?: InspectRunsOptions) {
  const stable = useMemo(() => stableRunsOptions(opts), [opts]);
  return useSuspenseQuery({
    queryKey: qk.inspect.runs(stable),
    queryFn: ({ signal }) => inspectService.runs(opts, signal),
  }).data;
}

export function useInspectRunDetailSuspense(traceId: string) {
  return useSuspenseQuery({
    queryKey: qk.inspect.run(traceId),
    queryFn: ({ signal }) => inspectService.runDetail(traceId, signal),
    refetchInterval: runDetailRefetchInterval,
  }).data;
}

export function useInspectInsightsSuspense() {
  return useSuspenseQuery({
    queryKey: qk.inspect.insights(),
    queryFn: ({ signal }) => inspectService.insights(signal),
  }).data;
}
