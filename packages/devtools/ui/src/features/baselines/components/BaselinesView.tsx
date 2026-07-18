import { useNavigation } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { Chip } from "@/devtools/shell/primitives";
import { DevtoolsEmpty } from "@/devtools/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useEvalBaselines } from "../hooks/useBaselines";

export function BaselinesView() {
  const { navigate } = useNavigation();
  const query = useEvalBaselines();
  const baselines = query.data ?? [];
  return (
    <DevtoolsShell
      breadcrumb="Evals / Baselines"
      title="Baselines"
      subtitle={`${baselines.length} accepted references`}
    >
      <div className="space-y-3 px-8 pb-10 pt-6">
        {query.isPending ? (
          <SkeletonRows rows={4} rowHeight={72} />
        ) : query.isError ? (
          <DevtoolsEmpty
            icon="alert"
            title="Baselines unavailable"
            body={query.error.message}
          />
        ) : baselines.length === 0 ? (
          <DevtoolsEmpty
            icon="bookmark"
            title="No Eval Baselines"
            body="Set a complete Eval run as the accepted historical reference."
          />
        ) : (
          baselines.map((baseline) => (
            <div
              key={baseline.baselineId}
              className="grid gap-3 rounded-[10px] px-4 py-3 md:grid-cols-[1fr_auto_auto]"
              style={{
                background: "var(--devtools-bg-elev)",
                border: "1px solid var(--devtools-border)",
              }}
            >
              <div>
                <div className="font-mono text-[13px] font-semibold">
                  {baseline.evalId}
                </div>
                <div
                  className="mt-1 font-mono text-[10.5px]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  accepted {new Date(baseline.promotedAt).toLocaleString()}
                  {baseline.promotedBy ? ` by ${baseline.promotedBy}` : ""}
                </div>
              </div>
              <Chip tone="muted">{baseline.selectedArm}</Chip>
              <Chip
                tone={
                  baseline.baselineCompatibility.status === "compatible"
                    ? "ok"
                    : baseline.baselineCompatibility.status === "unknown"
                      ? "warn"
                      : "danger"
                }
              >
                Current {baseline.baselineCompatibility.status}
              </Chip>
              <button
                type="button"
                className="cursor-pointer font-mono text-[11px] underline"
                style={{ color: "var(--devtools-crux)" }}
                onClick={() =>
                  navigate({ view: "eval-runs", runId: baseline.runId })
                }
              >
                {baseline.runId}
              </button>
              <div className="space-y-2 md:col-span-3">
                {baseline.baselineCompatibility.reason ? (
                  <p
                    className="text-[12px]"
                    style={{
                      color:
                        baseline.baselineCompatibility.status === "incompatible"
                          ? "var(--devtools-danger)"
                          : "var(--devtools-warn)",
                    }}
                  >
                    {baseline.baselineCompatibility.reason}
                  </p>
                ) : null}
                <div className="space-y-1.5">
                  {baseline.baselineCompatibility.cases.map((item) => (
                    <div
                      key={item.caseId}
                      className="rounded-[7px] px-3 py-2"
                      style={{ border: "1px solid var(--devtools-border)" }}
                    >
                      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                        <span>{item.caseId}</span>
                        <Chip
                          tone={
                            item.status === "compatible"
                              ? "ok"
                              : item.status === "unknown"
                                ? "warn"
                                : "danger"
                          }
                        >
                          {item.status}
                        </Chip>
                        {item.reason ? <span>{item.reason}</span> : null}
                      </div>
                      {item.metrics.length ? (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {item.metrics.map((metric) => (
                            <Chip
                              key={metric.name}
                              tone={
                                metric.status === "compatible"
                                  ? "ok"
                                  : metric.status === "unknown"
                                    ? "warn"
                                    : "danger"
                              }
                            >
                              {metric.name}: {metric.status}
                              {metric.reason ? ` (${metric.reason})` : ""}
                            </Chip>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {baseline.baselineCompatibility.currentOnlyCases?.map(
                    (caseId) => (
                      <div
                        key={caseId}
                        className="font-mono text-[11px]"
                        style={{ color: "var(--devtools-warn)" }}
                      >
                        {caseId}: missing from Baseline
                      </div>
                    ),
                  )}
                </div>
                {baseline.warnings?.map((warning) => (
                  <p
                    key={warning.code}
                    className="text-[12px]"
                    style={{ color: "var(--devtools-warn)" }}
                  >
                    {warning.message}
                  </p>
                ))}
                <div
                  className="text-[11px]"
                  style={{ color: "var(--devtools-fg-muted)" }}
                >
                  {baseline.coverage.length} Cases · created with{" "}
                  {baseline.toolVersion}
                </div>
                <div
                  className="font-mono text-[10.5px]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  definition {baseline.provenance.definitionFingerprint} · task{" "}
                  {baseline.provenance.taskFingerprint}
                </div>
                {baseline.coverage.map((item) => (
                  <div
                    key={item.caseId}
                    className="rounded-[7px] px-3 py-2"
                    style={{ background: "var(--devtools-bg-muted)" }}
                  >
                    <div className="font-mono text-[12px] font-semibold">
                      {item.caseId} · trials{" "}
                      {item.trials.map((trial) => trial + 1).join(", ")}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {Object.entries(item.metrics).map(([name, metric]) => (
                        <Chip key={name} tone="muted">
                          {name}:{" "}
                          {metric.values
                            .map(
                              (value) => value.value ?? value.label ?? "null",
                            )
                            .join(", ")}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </DevtoolsShell>
  );
}
