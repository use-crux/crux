import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { qk } from "@/shared/query/queryClient";
import { evalsService } from "../services/evals";

export function useEvalCatalog() {
  return useQuery({
    queryKey: qk.evals.catalog(),
    queryFn: ({ signal }) => evalsService.catalog(signal),
    refetchInterval: 2_000,
  });
}

export function useEvalRuns() {
  return useQuery({
    queryKey: qk.evals.runs(),
    queryFn: ({ signal }) => evalsService.runs(signal),
    refetchInterval: 2_000,
  });
}

/** Stop periodic detail reads once the server has returned a terminal error. */
export function evalRunRefetchInterval(error: unknown): number | false {
  return error ? false : 2_000;
}

export function useEvalRun(runId?: string) {
  return useQuery({
    queryKey: qk.evals.run(runId),
    queryFn: ({ signal }) => evalsService.run(runId ?? "", signal),
    enabled: Boolean(runId),
    refetchInterval: (query) => evalRunRefetchInterval(query.state.error),
  });
}

/** Run one discovered Eval through the Local coordinator. */
export function useRunEval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      evalId,
      confirmUnknownCost,
    }: {
      evalId: string;
      confirmUnknownCost: boolean;
    }) => evalsService.runEval(evalId, confirmUnknownCost),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.evals.all });
    },
  });
}

/** Prove which Eval result references resolve in this Local observability store. */
export function useLocalRunAvailability(runIds: readonly string[]) {
  const stableRunIds = useMemo(
    () => [...new Set(runIds)].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runIds.join("\u0000")],
  );
  return useQuery({
    queryKey: qk.evals.localRunAvailability(stableRunIds),
    queryFn: ({ signal }) =>
      evalsService.localRunAvailability(stableRunIds, signal),
    enabled: stableRunIds.length > 0,
  });
}

/** Accept one complete, unfiltered Eval run arm as the Baseline. */
export function useSetEvalBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      runId,
      variant,
      acceptFailing,
    }: {
      runId: string;
      variant?: string;
      acceptFailing?: boolean;
    }) => evalsService.setBaseline(runId, variant, acceptFailing),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.evals.baselines() });
    },
  });
}
