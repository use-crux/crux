import { useNavigation } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { Chip } from "@/devtools/shell/primitives";
import { useToast } from "@/devtools/shell/useToast";
import { DevtoolsEmpty } from "@/devtools/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useEvalCatalog, useEvalRuns, useRunEval } from "../hooks/useEvals";
import type { EvalCatalogEntry } from "../types";
import { useEvalBaselines } from "@/features/baselines/hooks/useBaselines";
import {
  currentArmStatus,
  hostReadinessDetails,
  hostReadinessPresentation,
} from "../lib/catalog-status";
import { EvalRunAction } from "./EvalRunAction";

export function EvalsView({ evalId }: { evalId?: string }) {
  const { navigate } = useNavigation();
  const { toast } = useToast();
  const query = useEvalCatalog();
  const runsQuery = useEvalRuns();
  const baselinesQuery = useEvalBaselines();
  const runEval = useRunEval();
  const entries = query.data ?? [];
  const selected = entries.find((entry) => entry.id === evalId);
  return (
    <DevtoolsShell
      breadcrumb="Evals"
      title="Evals"
      subtitle={`${entries.length} discovered definitions`}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.7fr)]">
        <div className="space-y-3">
          {query.isPending ? (
            <SkeletonRows rows={4} rowHeight={72} />
          ) : query.isError ? (
            <DevtoolsEmpty
              icon="alert"
              title="Eval discovery failed"
              body={query.error.message}
            />
          ) : entries.length === 0 ? (
            <DevtoolsEmpty
              icon="layers"
              title="No Evals discovered"
              body="Add a default-exported *.eval.ts definition to this project."
            />
          ) : (
            entries.map((entry) => {
              const lastRun = (runsQuery.data ?? [])
                .filter((run) => run.evalId === entry.id)
                .sort((left, right) => right.startedAt - left.startedAt)[0];
              const baseline = (baselinesQuery.data ?? []).find(
                (item) => item.evalId === entry.id,
              );
              const host = hostReadinessPresentation(entry.hostReadiness);
              const hostDetails = hostReadinessDetails(entry.hostReadiness);
              const current = lastRun
                ? currentArmStatus(lastRun, entry.definitionFingerprint)
                : undefined;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => navigate({ view: "evals", evalId: entry.id })}
                  className="block w-full cursor-pointer rounded-[10px] px-4 py-3 text-left transition-colors hover:opacity-90"
                  style={{
                    background: "var(--devtools-bg-elev)",
                    border: "1px solid var(--devtools-border)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[13px] font-semibold">
                      {entry.id}
                    </span>
                    <Chip tone="muted">{entry.cases.length} Cases</Chip>
                    <Chip tone="muted">
                      {Math.max(0, entry.variants.length - 1)} Variants
                    </Chip>
                    <Chip
                      tone={
                        current === "passed"
                          ? "ok"
                          : current === "stale"
                            ? "warn"
                            : current
                              ? "danger"
                              : "muted"
                      }
                    >
                      {current === "stale"
                        ? "Current not run · latest is stale"
                        : current
                          ? `Current ${current}`
                          : "Current not run"}
                    </Chip>
                    <Chip tone={baseline ? "ok" : "warn"}>
                      {baseline
                        ? `Baseline ${baseline.selectedArm}`
                        : "No Baseline"}
                    </Chip>
                    <Chip tone={host.tone}>{host.label}</Chip>
                  </div>
                  <div
                    className="mt-1.5 font-mono text-[11px]"
                    style={{ color: "var(--devtools-fg-muted)" }}
                  >
                    {entry.sourceKey.relativeFile}
                    {entry.requiredHostCapabilities?.length
                      ? ` · requires ${entry.requiredHostCapabilities.join(", ")}`
                      : ""}
                  </div>
                  {hostDetails.reason || hostDetails.remedies.length ? (
                    <div
                      className="mt-1 text-[11px]"
                      style={{
                        color:
                          entry.hostReadiness?.status === "mismatch"
                            ? "var(--devtools-danger)"
                            : "var(--devtools-warn)",
                      }}
                    >
                      {[hostDetails.reason, ...hostDetails.remedies]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <aside
          className="rounded-[10px] p-4"
          style={{
            background: "var(--devtools-bg-elev)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          {selected ? (
            <>
              <h2 className="font-mono text-[14px] font-semibold">
                {selected.id}
              </h2>
              {selected.description && (
                <p className="mt-2 text-[13px] leading-6">
                  {selected.description}
                </p>
              )}
              <EvalRunAction
                evalId={selected.id}
                pending={runEval.isPending}
                error={
                  runEval.isError && runEval.variables?.evalId === selected.id
                    ? runEval.error instanceof Error
                      ? runEval.error.message
                      : String(runEval.error)
                    : undefined
                }
                onRun={() =>
                  runEval.mutate(
                    { evalId: selected.id, confirmUnknownCost: true },
                    {
                      onSuccess: (result) => {
                        toast({
                          kind: result.passed ? "ok" : "warn",
                          title: result.passed
                            ? "Eval passed"
                            : "Eval completed with failures",
                          message: result.runId,
                        });
                        navigate({ view: "eval-runs", runId: result.runId });
                      },
                    },
                  )
                }
              />
              <RuntimeReadiness entry={selected} />
              <h3
                className="mt-5 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                Cases
              </h3>
              <div className="mt-2 space-y-1.5">
                {selected.cases.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 font-mono text-[12px]"
                  >
                    <span>{item.id}</span>
                    {item.unvalidatedExpected && (
                      <Chip tone="warn">expected unvalidated</Chip>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p
              className="text-[13px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              Select an Eval to inspect its source, Cases, and Variants.
            </p>
          )}
        </aside>
      </div>
    </DevtoolsShell>
  );
}

function RuntimeReadiness({ entry }: { entry: EvalCatalogEntry }) {
  const presentation = hostReadinessPresentation(entry.hostReadiness);
  const details = hostReadinessDetails(entry.hostReadiness);
  return (
    <section className="mt-5 space-y-2">
      <h3
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Runtime readiness
      </h3>
      <Chip tone={presentation.tone}>{presentation.label}</Chip>
      {entry.requiredHostCapabilities?.length ? (
        <p className="font-mono text-[11px]">
          Requires {entry.requiredHostCapabilities.join(", ")}
        </p>
      ) : null}
      {details.metadata.map((item) => (
        <p key={item} className="font-mono text-[11px]">
          {item}
        </p>
      ))}
      {details.reason ? (
        <p className="text-[12px]" style={{ color: "var(--devtools-warn)" }}>
          {details.reason}
        </p>
      ) : null}
      {details.remedies.map((remedy) => (
        <p key={remedy} className="text-[12px]">
          {remedy}
        </p>
      ))}
    </section>
  );
}
