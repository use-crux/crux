import type { EvalRunRecord } from "../types";

/** Explain whether a persisted run can become the accepted Baseline. */
export function baselineEligibility(
  run: EvalRunRecord,
):
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: string } {
  if (run.status !== "complete") {
    return {
      eligible: false,
      reason: "Incomplete runs cannot become Baselines.",
    };
  }
  if (run.selection.filtered === true) {
    return {
      eligible: false,
      reason: "Filtered runs cannot become Baselines.",
    };
  }
  return { eligible: true };
}

export function EvalRunBaselineAction({
  run,
  pending,
  onSet,
}: {
  readonly run: EvalRunRecord;
  readonly pending: boolean;
  readonly onSet: () => void;
}) {
  const eligibility = baselineEligibility(run);
  if (!eligibility.eligible) {
    return (
      <span className="text-[11px]" style={{ color: "var(--qw-fg-muted)" }}>
        {eligibility.reason}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={pending}
      onClick={onSet}
      className="cursor-pointer rounded-[7px] px-3 py-1.5 text-[12px] font-semibold disabled:cursor-wait disabled:opacity-60"
      style={{ background: "var(--qw-accent)", color: "var(--qw-bg)" }}
    >
      {pending ? "Setting Baseline…" : "Set current as Baseline"}
    </button>
  );
}
