import { useQuery } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { baselinesService } from "../services/baselines";

export function useEvalBaselines() {
  return useQuery({
    queryKey: qk.evals.baselines(),
    queryFn: ({ signal }) => baselinesService.list(signal),
  });
}
