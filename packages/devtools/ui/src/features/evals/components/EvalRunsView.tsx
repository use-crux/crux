import { useMemo, useState } from "react";
import { useNavigation } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { Chip } from "@/devtools/shell/primitives";
import { DevtoolsEmpty } from "@/devtools/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import {
  useEvalRun,
  useEvalRuns,
  useLocalRunAvailability,
  useSetEvalBaseline,
} from "../hooks/useEvals";
import { EvalRunBaselineAction } from "./EvalRunBaselineAction";
import { EvalCellDetail } from "./EvalCellDetail";
import { EvalRunComparison } from "./EvalRunComparison";
import { EvalRunSummary } from "./EvalRunSummary";
import { baselineArmForRun } from "../lib/run-controls";
import type { EvalRunRecord } from "../types";

export function EvalRunsView({ runId }: { runId?: string }) {
  const { navigate } = useNavigation();
  const list = useEvalRuns();
  const detail = useEvalRun(runId);
  const setBaseline = useSetEvalBaseline();
  const runs = list.data ?? [];
  const referencedRunIds = useMemo(
    () => detail.data?.cells.flatMap((cell) => cell.runIds ?? []) ?? [],
    [detail.data],
  );
  const localRuns = useLocalRunAvailability(referencedRunIds);
  const runAvailability = useMemo(
    () =>
      new Map(
        referencedRunIds.map((observedRunId) => [
          observedRunId,
          localRuns.isPending
            ? ("checking" as const)
            : localRuns.data?.get(observedRunId)
              ? ("available" as const)
              : ("unavailable" as const),
        ]),
      ),
    [localRuns.data, localRuns.isPending, referencedRunIds],
  );
  return (
    <DevtoolsShell
      breadcrumb="Evals / Eval runs"
      title="Eval runs"
      subtitle={`${runs.length} persisted runs`}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
        <div className="space-y-2">
          {list.isPending ? (
            <SkeletonRows rows={5} rowHeight={58} />
          ) : list.isError ? (
            <DevtoolsEmpty
              icon="alert"
              title="Runs unavailable"
              body={list.error.message}
            />
          ) : runs.length === 0 ? (
            <DevtoolsEmpty
              icon="flask"
              title="No Eval runs yet"
              body="Run crux eval to create the first comparable result."
            />
          ) : (
            runs.map((run) => (
              <button
                key={run.runId}
                type="button"
                onClick={() =>
                  navigate({ view: "eval-runs", runId: run.runId })
                }
                className="block w-full cursor-pointer rounded-[9px] px-3.5 py-3 text-left hover:opacity-90"
                style={{
                  background: "var(--devtools-bg-elev)",
                  border: "1px solid var(--devtools-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] font-semibold">
                    {run.evalId}
                  </span>
                  <Chip
                    tone={
                      run.status === "incomplete"
                        ? "warn"
                        : run.passed
                          ? "ok"
                          : "danger"
                    }
                  >
                    {run.status === "incomplete"
                      ? "incomplete"
                      : run.passed
                        ? "passed"
                        : "failed"}
                  </Chip>
                </div>
                <div
                  className="mt-1 font-mono text-[10.5px]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  {run.runId}
                </div>
              </button>
            ))
          )}
        </div>
        <div
          className="rounded-[10px] p-4"
          style={{
            background: "var(--devtools-bg-elev)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          {!runId ? (
            <p
              className="text-[13px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              Select a run to inspect exact cell execution and reuse reasons.
            </p>
          ) : detail.isPending ? (
            <SkeletonRows rows={4} rowHeight={48} />
          ) : detail.isError ? (
            <DevtoolsEmpty
              icon="alert"
              title="Run unavailable"
              body={detail.error.message}
            />
          ) : (
            detail.data && (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="font-mono text-[14px] font-semibold">
                    {detail.data.evalId}
                  </h2>
                  <Chip
                    tone={
                      detail.data.status === "incomplete"
                        ? "warn"
                        : detail.data.passed
                          ? "ok"
                          : "danger"
                    }
                  >
                    {detail.data.status === "incomplete"
                      ? "incomplete"
                      : detail.data.passed
                        ? "passed"
                        : "failed"}
                  </Chip>
                  <div className="ml-auto">
                    <ScopedBaselineAction
                      key={detail.data.runId}
                      run={detail.data}
                      pending={
                        setBaseline.isPending &&
                        setBaseline.variables?.runId === detail.data.runId
                      }
                      onSet={(variant) =>
                        setBaseline.mutate({
                          runId: detail.data.runId,
                          variant,
                          acceptFailing: !detail.data.passed,
                        })
                      }
                    />
                  </div>
                </div>
                {setBaseline.isError &&
                setBaseline.variables?.runId === detail.data.runId ? (
                  <p
                    className="mt-2 text-[11px]"
                    style={{ color: "var(--devtools-danger)" }}
                  >
                    {setBaseline.error.message}
                  </p>
                ) : null}
                <EvalRunSummary run={detail.data} />
                <EvalRunComparison
                  key={detail.data.runId}
                  run={detail.data}
                  runs={runs}
                />
                {detail.data.comparison ? (
                  <section className="mt-4 space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider">
                      Baseline comparison · {detail.data.comparison.selectedArm}
                    </h3>
                    {detail.data.comparison.cases.map((item) => (
                      <div
                        key={item.caseId}
                        className="rounded-[7px] px-3 py-2 text-[12px]"
                        style={{ border: "1px solid var(--devtools-border)" }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {item.caseId}
                          </span>
                          <Chip
                            tone={item.status === "compatible" ? "ok" : "warn"}
                          >
                            {item.status}
                          </Chip>
                          {item.reason ? <span>{item.reason}</span> : null}
                        </div>
                        {item.metrics.map((metric) => (
                          <div
                            key={metric.name}
                            className="mt-1 font-mono text-[11px]"
                          >
                            {metric.name}:{" "}
                            {metric.status === "compatible"
                              ? `${metric.baseline ?? "null"} → ${metric.candidate ?? "null"} (${metric.delta === null ? "no delta" : `${metric.delta >= 0 ? "+" : ""}${metric.delta}`})`
                              : metric.reason}
                          </div>
                        ))}
                      </div>
                    ))}
                  </section>
                ) : null}
                <div className="mt-4 space-y-2">
                  {detail.data.cells.map((cell, index) => (
                    <EvalCellDetail
                      key={`${cell.caseId}:${cell.variant}:${index}`}
                      cell={cell}
                      runAvailability={runAvailability}
                      onOpenRun={(observedRunId) =>
                        navigate({ view: "run-detail", traceId: observedRunId })
                      }
                    />
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </DevtoolsShell>
  );
}

function ScopedBaselineAction({
  run,
  pending,
  onSet,
}: {
  readonly run: EvalRunRecord;
  readonly pending: boolean;
  readonly onSet: (arm: string) => void;
}) {
  const [requestedArm, setRequestedArm] = useState("current");
  const selectedArm = baselineArmForRun(run, requestedArm);
  return (
    <EvalRunBaselineAction
      run={run}
      pending={pending}
      selectedArm={selectedArm}
      onArmChange={setRequestedArm}
      onSet={() => onSet(selectedArm)}
    />
  );
}
