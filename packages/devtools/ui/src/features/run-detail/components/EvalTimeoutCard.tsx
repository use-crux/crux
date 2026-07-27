import type { ObservabilityRunDetailNode } from "@/types";
import { formatTimeoutMs } from "@/shared/lib/format-timeout-ms";
import { CardShell } from "./SpanDetailPanelAtoms";

type TimeoutBudget = "total" | "step" | "chunk" | "firstToken" | "tool";

interface EvalTimeoutPresentation {
  readonly budget: TimeoutBudget;
  readonly limitMs: number;
  readonly toolName?: string;
}

const budgetLabels = {
  total: "Total",
  step: "Step",
  chunk: "Chunk",
  firstToken: "First token",
  tool: "Tool",
} as const satisfies Readonly<Record<TimeoutBudget, string>>;

function isTimeoutBudget(value: unknown): value is TimeoutBudget {
  return Object.hasOwn(budgetLabels, String(value));
}

/**
 * Strictly project the structured Eval timeout terminal used by normal Runs.
 *
 * Malformed and legacy records intentionally return `null`; timeout status is
 * never inferred from error text.
 */
export function projectEvalTimeoutPresentation(
  node: ObservabilityRunDetailNode,
): EvalTimeoutPresentation | null {
  if (node.primitive !== "eval.case" || node.status !== "cancelled") return null;
  const attributes = node.attributes;
  if (
    attributes === null ||
    attributes === undefined ||
    attributes.evalOutcome !== "timed_out" ||
    !isTimeoutBudget(attributes.timeoutBudget) ||
    typeof attributes.timeoutLimitMs !== "number" ||
    !Number.isFinite(attributes.timeoutLimitMs) ||
    attributes.timeoutLimitMs <= 0
  ) {
    return null;
  }

  const budget = attributes.timeoutBudget;
  const toolName = attributes.timeoutToolName;
  if (budget === "tool") {
    return typeof toolName === "string" && toolName.trim().length > 0
      ? { budget, limitMs: attributes.timeoutLimitMs, toolName }
      : null;
  }
  return toolName === undefined
    ? { budget, limitMs: attributes.timeoutLimitMs }
    : null;
}

function TimeoutCause({
  timeout,
}: {
  readonly timeout: EvalTimeoutPresentation;
}) {
  return (
    <p className="font-mono text-[11px]">
      {budgetLabels[timeout.budget]} budget ·{" "}
      {formatTimeoutMs(timeout.limitMs)}
      {timeout.toolName ? (
        <>
          {" · "}
          <code>{timeout.toolName}</code>
        </>
      ) : null}
    </p>
  );
}

/**
 * Render a cancelled Eval Case, specializing exact timeout terminals while
 * preserving generic cancellation for malformed and legacy Runs.
 */
export function EvalTimeoutCard({
  node,
}: {
  readonly node: ObservabilityRunDetailNode;
}) {
  const timeout = projectEvalTimeoutPresentation(node);
  if (!timeout) {
    return (
      <CardShell label="Status">
        <div className="px-3.5 py-3 text-[13px]">Cancelled</div>
      </CardShell>
    );
  }

  return (
    <CardShell label="Status">
      <div
        className="space-y-1.5 px-3.5 py-3"
        style={{
          background: "var(--devtools-warn-soft)",
          color: "var(--devtools-warn)",
        }}
      >
        <div className="text-[13px] font-semibold">Timed out</div>
        <TimeoutCause timeout={timeout} />
        <p
          className="text-[11.5px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          Cancellation is cooperative; late Eval evidence was quarantined.
        </p>
      </div>
    </CardShell>
  );
}
