import { Chip } from "@/qw/shell/primitives";
import type { EvalRunRecord } from "../types";

/** Compact diagnostic summary derived exclusively from the persisted run. */
export function EvalRunSummary({ run }: { readonly run: EvalRunRecord }) {
  const aggregates = Object.entries(run.aggregates ?? {});
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
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
        <Stat label="Completeness" value={run.status} />
      </div>
      {aggregates.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {aggregates.map(([variant, aggregate]) => (
            <Chip key={variant} tone={aggregate.passRate === 1 ? "ok" : "warn"}>
              {variant}: {Math.round(aggregate.passRate * 100)}% ·{" "}
              {Math.round(aggregate.latencyMs)} ms
            </Chip>
          ))}
        </div>
      ) : null}
      {run.gates?.results.length ? (
        <div className="space-y-1.5">
          {run.gates.results.map((gate, index) => (
            <div
              key={`${gate.gate}:${gate.variantName}:${index}`}
              className="flex items-center gap-2 text-[11px]"
              style={{ color: "var(--qw-fg-muted)" }}
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
        <p className="text-[11px]" style={{ color: "var(--qw-danger)" }}>
          Incomplete: {run.reasons.join(" · ")}
        </p>
      ) : null}
    </div>
  );
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
      style={{ background: "var(--qw-bg-muted)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide"
        style={{ color: "var(--qw-fg-faint)" }}
      >
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[12px]">{value}</div>
    </div>
  );
}
