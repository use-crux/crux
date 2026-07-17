import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { evalsService } from "../services/evals";

export function useEvalCatalog() {
  return useQuery({
    queryKey: qk.evals.catalog(),
    queryFn: ({ signal }) => evalsService.catalog(signal),
  });
}

export function useEvalRuns() {
  return useQuery({
    queryKey: qk.evals.runs(),
    queryFn: ({ signal }) => evalsService.runs(signal),
  });
}

export function useEvalRun(runId?: string) {
  return useQuery({
    queryKey: qk.evals.run(runId),
    queryFn: ({ signal }) => evalsService.run(runId ?? "", signal),
    enabled: Boolean(runId),
  });
}

/** Accept one complete, unfiltered Eval run arm as the Baseline. */
export function useSetEvalBaseline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, variant }: { runId: string; variant?: string }) =>
      evalsService.setBaseline(runId, variant),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.evals.baselines() });
    },
  });
}
