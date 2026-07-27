/** Pure deadline selection for one remotely admitted Eval cell. @internal */

const EVAL_HOST_SAFETY_LIMIT_MS = 10 * 60_000;

/** Absolute V2 deadline and the relative budget that selected it. */
export interface RemoteEvalDeadline {
  readonly deadlineAtMs: number;
  readonly source: "eval" | "host";
  readonly limitMs: number;
}

/**
 * Select the earlier authored total budget and independent Host safety limit.
 *
 * Equal limits select the Eval source so terminal mapping remains
 * deterministic across coordinator and Host clocks.
 */
export function selectRemoteEvalDeadline(input: {
  readonly nowMs: number;
  readonly totalMs: number | null | undefined;
}): RemoteEvalDeadline {
  const evalWins =
    typeof input.totalMs === "number" &&
    input.totalMs <= EVAL_HOST_SAFETY_LIMIT_MS;
  const limitMs = evalWins ? input.totalMs : EVAL_HOST_SAFETY_LIMIT_MS;
  return Object.freeze({
    deadlineAtMs: input.nowMs + limitMs,
    source: evalWins ? "eval" : "host",
    limitMs,
  });
}
