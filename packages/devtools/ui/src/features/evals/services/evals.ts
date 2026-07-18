import { expectOk, fetchJson, postJson } from "@/shared/services/http";
import type {
  EvalCatalogEntry,
  RunEvalResult,
  SetEvalBaselineResult,
} from "../types";
import { parseEvalRun, parseEvalRunList } from "../lib/parse-run";

export const evalsService = {
  catalog: (signal?: AbortSignal) =>
    fetchJson<readonly EvalCatalogEntry[]>("/api/eval/catalog", signal),
  runs: async (signal?: AbortSignal) =>
    parseEvalRunList(await fetchJson<unknown>("/api/eval/runs", signal)),
  run: async (runId: string, signal?: AbortSignal) =>
    parseEvalRun(
      await fetchJson<unknown>(
        `/api/eval/runs/${encodeURIComponent(runId)}`,
        signal,
      ),
    ),
  async runEval(evalId: string, confirmUnknownCost: boolean) {
    const response = await postJson("/api/eval/runs", {
      evalId,
      confirmUnknownCost,
    });
    await expectOk(response, "run Eval");
    const result = (await response.json()) as Partial<RunEvalResult>;
    if (
      result.evalId !== evalId ||
      typeof result.runId !== "string" ||
      result.runId === "" ||
      !Array.isArray(result.runIds) ||
      !result.runIds.every((runId) => typeof runId === "string") ||
      (result.exitCode !== 0 && result.exitCode !== 1) ||
      typeof result.passed !== "boolean"
    ) {
      throw new TypeError(`malformed Run Eval response for '${evalId}'`);
    }
    return result as RunEvalResult;
  },
  async localRunAvailability(
    runIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, boolean>> {
    const uniqueRunIds = [...new Set(runIds)];
    const entries = await Promise.all(
      uniqueRunIds.map(async (runId) => {
        const rows = await fetchJson<readonly { traceId?: unknown }[]>(
          `/api/inspect/runs?search=${encodeURIComponent(runId)}&limit=1`,
          signal,
        );
        return [runId, rows.some((row) => row.traceId === runId)] as const;
      }),
    );
    return new Map(entries);
  },
  async setBaseline(
    runId: string,
    variant = "current",
    acceptFailing = false,
  ) {
    const response = await postJson("/api/eval/baselines", {
      runId,
      variant,
      acceptFailing,
    });
    await expectOk(response, "set Eval Baseline");
    return (await response.json()) as SetEvalBaselineResult;
  },
};
