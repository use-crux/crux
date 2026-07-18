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
  selectedArm,
  onArmChange,
  onSet,
}: {
  readonly run: EvalRunRecord;
  readonly pending: boolean;
  readonly selectedArm: string;
  readonly onArmChange: (arm: string) => void;
  readonly onSet: () => void;
}) {
  const eligibility = baselineEligibility(run);
  if (!eligibility.eligible) {
    return (
      <span
        className="text-[11px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        {eligibility.reason}
      </span>
    );
  }
  const arms = run.variants?.map((variant) => variant.name) ?? ["current"];
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <label
        className="text-[11px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Arm{" "}
        <select
          value={selectedArm}
          onChange={(event) => onArmChange(event.target.value)}
          className="rounded-[6px] px-2 py-1 font-mono"
          style={{
            background: "var(--devtools-bg)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          {arms.map((arm) => (
            <option key={arm} value={arm}>
              {arm}
            </option>
          ))}
        </select>
      </label>
      {!run.passed ? (
        <span className="text-[11px]" style={{ color: "var(--devtools-warn)" }}>
          This run failed. Accepting it changes the comparison reference.
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={onSet}
        className="cursor-pointer rounded-[7px] px-3 py-1.5 text-[12px] font-semibold disabled:cursor-wait disabled:opacity-60"
        style={{
          background: "var(--devtools-crux)",
          color: "var(--devtools-bg)",
        }}
      >
        {pending
          ? "Setting Baseline…"
          : run.passed
            ? `Set ${selectedArm} as Baseline`
            : `Accept ${selectedArm} as Baseline anyway`}
      </button>
    </div>
  );
}
