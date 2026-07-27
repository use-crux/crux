import { formatTimeoutMs } from "@/shared/lib/format-timeout-ms";

export interface EvalTimeoutOutcomeData {
  readonly budget: "total" | "step" | "chunk" | "firstToken" | "tool";
  readonly limitMs: number;
  readonly toolName?: string;
}

const budgetLabels = {
  total: "Total",
  step: "Step",
  chunk: "Chunk",
  firstToken: "First token",
  tool: "Tool",
} as const satisfies Readonly<Record<EvalTimeoutOutcomeData["budget"], string>>;

/**
 * Render the canonical structured cause of one Eval timeout.
 *
 * @param props.timeout - Persisted timeout budget, limit, and Tool coupling.
 * @returns Stable user-facing timeout copy shared by Eval and normal Runs.
 */
export function EvalTimeoutOutcome({
  timeout,
}: {
  readonly timeout: EvalTimeoutOutcomeData;
}) {
  const tool =
    timeout.budget === "tool" && timeout.toolName
      ? ` · ${timeout.toolName}`
      : "";
  return (
    <p className="font-mono text-[11px]">
      Timed out · {budgetLabels[timeout.budget]} budget ·{" "}
      {formatTimeoutMs(timeout.limitMs)}
      {tool}
    </p>
  );
}
