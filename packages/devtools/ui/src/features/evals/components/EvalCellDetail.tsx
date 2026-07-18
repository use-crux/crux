import { Chip } from "@/devtools/shell/primitives";
import type { EvalRunRecord } from "../types";

type EvalCell = EvalRunRecord["cells"][number];
export type LocalRunEvidenceStatus = "checking" | "available" | "unavailable";

export function EvalCellDetail({
  cell,
  onOpenRun,
  runAvailability,
}: {
  readonly cell: EvalCell;
  readonly onOpenRun: (runId: string) => void;
  readonly runAvailability?: ReadonlyMap<string, LocalRunEvidenceStatus>;
}) {
  const reason = cell.task.reason;
  return (
    <article
      className="space-y-3 rounded-[8px] p-3"
      style={{ background: "var(--devtools-bg-muted)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12px] font-semibold">
          {cell.caseId} / {cell.variant} / trial {(cell.trial ?? 0) + 1}
        </span>
        <Chip tone={cell.status === "passed" ? "ok" : "danger"}>
          {cell.status}
        </Chip>
        <Chip tone="muted">
          {cell.task.status}
          {reason ? `: ${reason}` : ""}
        </Chip>
        {cell.metrics ? (
          <span className="ml-auto font-mono text-[11px]">
            {cell.metrics.durationMs}ms
            {cell.metrics.costUsd === undefined
              ? ""
              : ` · $${cell.metrics.costUsd.toFixed(6)}`}
          </span>
        ) : null}
      </div>

      {cell.error ? (
        <p
          role="alert"
          className="text-[12px]"
          style={{ color: "var(--devtools-danger)" }}
        >
          {cell.error.phase}: {cell.error.message}
        </p>
      ) : null}

      {cell.scores?.length ? (
        <section>
          <EvidenceHeading>Scores</EvidenceHeading>
          <div className="mt-1.5 space-y-1.5">
            {cell.scores.map((score, index) => (
              <div key={`${score.name}:${index}`} className="text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-semibold">{score.name}</span>
                  <Chip
                    tone={
                      score.status === "errored"
                        ? "danger"
                        : score.status === "missing"
                          ? "warn"
                          : score.status === "reused"
                            ? "muted"
                            : "ok"
                    }
                  >
                    {score.status} · {score.reason}
                  </Chip>
                  {score.value !== undefined ? (
                    <span className="font-mono">
                      {score.value ?? "null"}
                      {score.label ? ` (${score.label})` : ""}
                    </span>
                  ) : null}
                </div>
                {score.message ? (
                  <p
                    className="mt-0.5"
                    style={{ color: "var(--devtools-danger)" }}
                  >
                    {score.message}
                  </p>
                ) : null}
                {score.work ? (
                  <div
                    className="mt-1 flex flex-wrap gap-2 font-mono text-[10.5px]"
                    style={{ color: "var(--devtools-fg-muted)" }}
                  >
                    <span>
                      work {score.work.status}: {score.work.reason}
                    </span>
                    {score.work.evidenceRef ? (
                      <span>evidence {score.work.evidenceRef}</span>
                    ) : null}
                    <span>reservation {score.work.reservation}</span>
                  </div>
                ) : null}
                {score.rationale ? (
                  <p
                    className="mt-0.5"
                    style={{ color: "var(--devtools-fg-muted)" }}
                  >
                    {score.rationale}
                  </p>
                ) : null}
                {score.metrics ? (
                  <div
                    className="mt-0.5 font-mono text-[10.5px]"
                    style={{ color: "var(--devtools-fg-muted)" }}
                  >
                    judge
                    {score.metrics.actualUsd === undefined
                      ? ""
                      : ` · $${score.metrics.actualUsd.toFixed(6)}`}
                    {score.metrics.usage === undefined
                      ? ""
                      : ` · ${score.metrics.usage.totalTokens} tokens`}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {cell.assertions?.outcomes.length ? (
        <section>
          <EvidenceHeading>
            Assertions ·{" "}
            {cell.assertions.ran -
              cell.assertions.outcomes.filter(
                (item) => item.status === "failed",
              ).length}
            /{cell.assertions.ran} passed
          </EvidenceHeading>
          <div className="mt-1.5 space-y-1">
            {cell.assertions.outcomes.map((assertion) => (
              <div key={assertion.id} className="flex gap-2 text-[12px]">
                <Chip tone={assertion.status === "passed" ? "ok" : "danger"}>
                  {assertion.status}
                </Chip>
                <span>
                  {assertion.matcher}
                  {assertion.message ? ` · ${assertion.message}` : ""}
                  {assertion.expression?.rendered
                    ? ` · ${assertion.expression.rendered}`
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-2 md:grid-cols-3">
        <JsonEvidence label="Input" value={cell.input} />
        <JsonEvidence label="Output" value={cell.output} />
        <JsonEvidence label="Expected" value={cell.expected} />
      </div>

      {cell.runIds?.length ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span style={{ color: "var(--devtools-fg-muted)" }}>
            Observed runs
          </span>
          {cell.runIds.map((runId) => {
            const availability = runAvailability?.get(runId) ?? "unavailable";
            return availability === "available" ? (
              <button
                key={runId}
                type="button"
                aria-label={`Open observed run ${runId}`}
                onClick={() => onOpenRun(runId)}
                className="cursor-pointer font-mono underline"
                style={{ color: "var(--devtools-crux)" }}
              >
                {runId}
              </button>
            ) : (
              <span key={runId} className="flex flex-wrap items-center gap-2">
                <span className="select-text font-mono">{runId}</span>
                <Chip tone={availability === "checking" ? "muted" : "warn"}>
                  {availability === "checking"
                    ? "Checking local run evidence…"
                    : "Run evidence unavailable locally"}
                </Chip>
              </span>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}

function EvidenceHeading({ children }: { readonly children: React.ReactNode }) {
  return (
    <h3
      className="text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: "var(--devtools-fg-muted)" }}
    >
      {children}
    </h3>
  );
}

function JsonEvidence({
  label,
  value,
}: {
  readonly label: string;
  readonly value: unknown;
}) {
  if (value === undefined) return null;
  return (
    <details
      className="rounded-[6px] p-2"
      style={{ border: "1px solid var(--devtools-border)" }}
    >
      <summary className="cursor-pointer text-[11px] font-semibold">
        {label}
      </summary>
      <pre className="mt-2 overflow-auto text-[10.5px] leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
