import { useNavigation } from "@/app/navigation/useNavigation";
import { navTarget } from "@/app/navigation/navTarget";
import { useConnected } from "@/app/runtime/runtimeStore";
import { QwShell } from "@/qw/shell/QwShell";
import { Chip } from "@/qw/shell/primitives";
import { QEmpty } from "@/qw/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useEvalRun, useEvalRuns, useSetEvalBaseline } from "../hooks/useEvals";
import { EvalRunBaselineAction } from "./EvalRunBaselineAction";
import { EvalRunSummary } from "./EvalRunSummary";

export function EvalRunsView({ runId }: { runId?: string }) {
  const connected = useConnected();
  const { navigate } = useNavigation();
  const list = useEvalRuns();
  const detail = useEvalRun(runId);
  const setBaseline = useSetEvalBaseline();
  const runs = list.data ?? [];
  return (
    <QwShell
      activeView="eval-runs"
      onNavigate={(view) => navigate(navTarget(view))}
      breadcrumb="Evals / Eval runs"
      title="Eval runs"
      subtitle={`${runs.length} persisted runs`}
      connected={connected}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(340px,0.8fr)_minmax(0,1.4fr)]">
        <div className="space-y-2">
          {list.isPending ? (
            <SkeletonRows rows={5} rowHeight={58} />
          ) : list.isError ? (
            <QEmpty
              icon="alert"
              title="Runs unavailable"
              body={list.error.message}
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
                  background: "var(--qw-bg-elev)",
                  border: "1px solid var(--qw-border)",
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
                  style={{ color: "var(--qw-fg-faint)" }}
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
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
          }}
        >
          {!runId ? (
            <p className="text-[13px]" style={{ color: "var(--qw-fg-muted)" }}>
              Select a run to inspect exact cell execution and reuse reasons.
            </p>
          ) : detail.isPending ? (
            <SkeletonRows rows={4} rowHeight={48} />
          ) : detail.isError ? (
            <QEmpty
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
                  <Chip tone={detail.data.passed ? "ok" : "danger"}>
                    {detail.data.passed ? "passed" : detail.data.status}
                  </Chip>
                  <div className="ml-auto">
                    <EvalRunBaselineAction
                      run={detail.data}
                      pending={setBaseline.isPending}
                      onSet={() =>
                        setBaseline.mutate({ runId: detail.data.runId })
                      }
                    />
                  </div>
                </div>
                {setBaseline.isError ? (
                  <p
                    className="mt-2 text-[11px]"
                    style={{ color: "var(--qw-danger)" }}
                  >
                    {setBaseline.error.message}
                  </p>
                ) : null}
                <EvalRunSummary run={detail.data} />
                <div className="mt-4 space-y-2">
                  {detail.data.cells.map((cell, index) => (
                    <div
                      key={`${cell.caseId}:${cell.variant}:${index}`}
                      className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-[7px] px-3 py-2.5"
                      style={{ background: "var(--qw-bg-muted)" }}
                    >
                      <span className="font-mono text-[12px]">
                        {cell.caseId} / {cell.variant}
                      </span>
                      <Chip tone="muted">{cell.task.status}</Chip>
                      <span
                        className="text-[11px]"
                        style={{ color: "var(--qw-fg-muted)" }}
                      >
                        {cell.task.reuseReason ?? cell.status}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )
          )}
        </div>
      </div>
    </QwShell>
  );
}
