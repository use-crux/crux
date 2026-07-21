import type { CruxGuardrailReportPreview } from "@use-crux/core/observability";
import { inputOriginFacts } from "@/shared/lib/safety-presentation";

export type GuardrailFactRow = [label: string, value: string, color?: string];

/** Build descriptor-only inspector rows for a canonical guardrail report. */
export function guardrailReportRows(
  report: CruxGuardrailReportPreview,
): GuardrailFactRow[] {
  const rows: GuardrailFactRow[] = [];
  if (report.target)
    rows.push(["target", report.target.label || report.target.id]);
  const origin = inputOriginFacts(report.origin);
  if (origin.source)
    rows.push([
      "source",
      [origin.source, origin.identifier].filter(Boolean).join(" · "),
    ]);
  if (report.mode) rows.push(["mode", report.mode]);
  if (report.phase) rows.push(["phase", report.phase]);
  rows.push(["action", report.action, actionColor(report.action)]);
  const location = guardrailLocation(report);
  if (location) rows.push(["origin", location]);
  if (report.escalatedToBlock)
    rows.push(["escalation", "strip to block", "var(--devtools-danger)"]);
  if (report.matches?.length)
    rows.push(["matches", String(report.matches.length)]);
  return rows;
}

function guardrailLocation(
  report: CruxGuardrailReportPreview,
): string | undefined {
  if (
    report.originKind === "message" &&
    report.messageIndex != null &&
    report.partIndex != null
  ) {
    return `message ${report.messageIndex} · part ${report.partIndex} · ${report.mediaPartType ?? "media"}`;
  }
  if (
    report.originKind === "step" &&
    report.stepIndex != null &&
    report.partIndex != null
  ) {
    return `step ${report.stepIndex} · part ${report.partIndex} · ${report.mediaPartType ?? "media"}`;
  }
  if (
    report.originKind === "operation" &&
    report.operation &&
    report.operationPhase &&
    report.field &&
    report.partIndex != null
  ) {
    return `${report.operation} · ${report.operationPhase} · ${report.field} · part ${report.partIndex} · ${report.mediaPartType ?? "media"}`;
  }
  return undefined;
}

function actionColor(action: string): string {
  if (action === "block") return "var(--devtools-danger)";
  if (action === "pass" || action === "allow") return "var(--devtools-ok)";
  return "var(--devtools-warn)";
}
