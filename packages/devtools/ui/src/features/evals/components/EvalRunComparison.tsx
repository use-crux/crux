import { useState } from "react";
import { comparableEvalRuns } from "../lib/run-controls";
import { compareEvalRuns } from "../lib/run-diff";
import type { EvalRunRecord } from "../types";

/** Compare one selected Eval run with another run of the same definition. */
export function EvalRunComparison({
  run,
  runs,
}: {
  readonly run: EvalRunRecord;
  readonly runs: readonly EvalRunRecord[];
}) {
  const [compareRunId, setCompareRunId] = useState("");
  const candidates = comparableEvalRuns(run, runs);
  const comparisonRun = candidates.find(
    (candidate) => candidate.runId === compareRunId,
  );
  const comparison = comparisonRun
    ? compareEvalRuns(comparisonRun, run)
    : undefined;
  return (
    <section
      className="mt-4 rounded-[8px] p-3"
      style={{ border: "1px solid var(--devtools-border)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider">
          Compare runs
        </h3>
        <select
          aria-label="Compare with run"
          value={comparisonRun?.runId ?? ""}
          onChange={(event) => setCompareRunId(event.target.value)}
          className="ml-auto rounded-[6px] px-2 py-1 font-mono text-[11px]"
          style={{
            background: "var(--devtools-bg)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          <option value="">Choose an earlier run…</option>
          {candidates.map((candidate) => (
            <option key={candidate.runId} value={candidate.runId}>
              {candidate.runId}
            </option>
          ))}
        </select>
      </div>
      {!comparison ? (
        <p
          className="mt-2 text-[11px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          Choose a run to see per-trial status, latency, and score deltas.
        </p>
      ) : (
        <div className="mt-2 space-y-1.5">
          <p className="font-mono text-[10.5px]">
            {comparison.fromRunId} → {comparison.toRunId}
          </p>
          {comparison.cells.map((cell) => (
            <div
              key={cell.key}
              className="rounded-[6px] px-2 py-1.5 font-mono text-[10.5px]"
              style={{ background: "var(--devtools-bg-muted)" }}
            >
              <div>
                {cell.key}: {cell.status.from} → {cell.status.to}
                {cell.durationMsDelta === undefined
                  ? ""
                  : ` · latency ${cell.durationMsDelta >= 0 ? "+" : ""}${cell.durationMsDelta}ms`}
              </div>
              {cell.scores.map((score) => (
                <div key={score.name}>
                  {score.name}: {score.from ?? "missing"} →{" "}
                  {score.to ?? "missing"}
                  {score.delta === null
                    ? ""
                    : ` (${score.delta >= 0 ? "+" : ""}${score.delta})`}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
