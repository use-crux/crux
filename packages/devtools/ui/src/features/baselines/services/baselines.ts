import { fetchJson } from "@/shared/services/http";
import type { EvalBaselineRecord } from "../types";

export const baselinesService = {
  list: (signal?: AbortSignal) =>
    fetchJson<readonly EvalBaselineRecord[]>("/api/eval/baselines", signal),
};
