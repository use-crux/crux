import { Chip } from "@/devtools/shell/primitives";
import type { EvalRunRecord } from "../types";

/** Compact diagnostic summary derived exclusively from the persisted run. */
export function EvalRunSummary({ run }: { readonly run: EvalRunRecord }) {
  const aggregates = Object.entries(run.aggregates ?? {});
  const hasUnattestedModel = run.cells.some(
    (cell) => cell.task.reason === "model_identity_unattested",
  );
  const hasUnresolvedSource = run.cells.some(
    (cell) => cell.task.reason === "unresolved_source_dependency",
  );
  const hasUntrackedTaskBinding = run.cells.some(
    (cell) => cell.task.reason === "task_binding_untracked",
  );
  const hasNondeterministicRenderer = run.cells.some(
    (cell) => cell.task.reason === "nondeterministic_renderer",
  );
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat
          label="Duration"
          value={`${Math.max(0, run.endedAt - run.startedAt)} ms`}
        />
        <Stat
          label="Cost"
          value={
            run.cost?.actualUsd == null
              ? "unknown"
              : `$${run.cost.actualUsd.toFixed(4)}`
          }
        />
        <Stat label="Task cost" value={formatCost(run.cost?.task.actualUsd)} />
        <Stat
          label="Judge cost"
          value={formatCost(run.cost?.judge.actualUsd)}
        />
        <Stat label="Completeness" value={run.status} />
      </div>
      {aggregates.length > 0 ? (
        <div className="space-y-2">
          {aggregates.map(([variant, aggregate]) => {
            const timedOut = aggregate.timedOut ?? 0;
            return (
              <div key={variant} className="space-y-2">
                <Chip tone={aggregate.passRate === 1 ? "ok" : "warn"}>
                  {variant}: {Math.round(aggregate.passRate * 100)}% ·{" "}
                  {Math.round(aggregate.latencyMs)} ms
                  {timedOut > 0 ? ` · ${timedOut} timed out` : ""}
                </Chip>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat label="Passed" value={String(aggregate.passed)} />
                  <Stat label="Failed" value={String(aggregate.failed)} />
                  <Stat label="Errored" value={String(aggregate.errored)} />
                  <Stat label="Timed out" value={String(timedOut)} />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {hasUnattestedModel ? (
        <p className="text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          Reuse is disabled because this AI SDK model has no stable identity.
          Wrap it with <code>stableModel(model)</code> from{" "}
          <code>@use-crux/ai</code>.
        </p>
      ) : null}
      {hasUnresolvedSource ? (
        <p className="text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          Reuse is disabled because Crux could not prove the complete authored
          source dependency closure. Import the production task and prompt
          dependencies with literal ESM; ambient environment, filesystem, or
          network state must be routed through Case input, call options, or
          Variants, or run fresh.
        </p>
      ) : null}
      {hasUntrackedTaskBinding ? (
        <p className="text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          Reuse is disabled because the managed task binding is not a literal
          ESM import. Move <code>generate.task()</code> or{" "}
          <code>stream.task()</code> into a production module and import that
          task into the Eval.
        </p>
      ) : null}
      {hasNondeterministicRenderer ? (
        <p className="text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          Cached evidence was not reused because this prompt rendered
          differently for the same input. Move environment, time, randomness,
          filesystem, or network state into Case input, call options, or a
          Variant, or run fresh intentionally.
        </p>
      ) : null}
      {run.gates?.results.length ? (
        <div className="space-y-1.5">
          {run.gates.results.map((gate, index) => (
            <div
              key={`${gate.gate}:${gate.variantName}:${index}`}
              className="flex items-center gap-2 text-[11px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              <Chip tone={gate.passed ? "ok" : "danger"}>
                {gate.passed ? "pass" : "fail"}
              </Chip>
              <span className="font-mono">
                {gate.variantName} / {gate.gate}: {String(gate.actual)} vs{" "}
                {String(gate.threshold)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {run.reasons?.length ? (
        <p className="text-[11px]" style={{ color: "var(--devtools-danger)" }}>
          Incomplete: {run.reasons.join(" · ")}
        </p>
      ) : null}
    </div>
  );
}

function formatCost(value: number | undefined): string {
  return value === undefined ? "unknown" : `$${value.toFixed(4)}`;
}

function Stat({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div
      className="rounded-[7px] px-3 py-2"
      style={{ background: "var(--devtools-bg-muted)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px]">{value}</div>
    </div>
  );
}
