import { expectOk, fetchJson, postJson } from "@/shared/services/http";
import type {
  EvalCatalogEntry,
  EvalRunRecord,
  SetEvalBaselineResult,
} from "../types";

export const evalsService = {
  catalog: (signal?: AbortSignal) =>
    fetchJson<readonly EvalCatalogEntry[]>("/api/eval/catalog", signal),
  runs: (signal?: AbortSignal) =>
    fetchJson<readonly EvalRunRecord[]>("/api/eval/runs", signal),
  run: (runId: string, signal?: AbortSignal) =>
    fetchJson<EvalRunRecord>(
      `/api/eval/runs/${encodeURIComponent(runId)}`,
      signal,
    ),
  async setBaseline(runId: string, variant = "current") {
    const response = await postJson("/api/eval/baselines", { runId, variant });
    await expectOk(response, "set Eval Baseline");
    return (await response.json()) as SetEvalBaselineResult;
  },
};
