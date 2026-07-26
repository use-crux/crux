import type { CruxGuardrailReportPreview } from "@use-crux/core/observability";
import { inputOriginFacts } from "@/shared/lib/safety-presentation";

export type GuardrailFactRow = [
  label: string,
  value: string,
  color?: string,
  key?: string,
];

/** A guardrail row whose stable React-list identity has been assigned. */
export type KeyedGuardrailFactRow = [
  label: string,
  value: string,
  color: string | undefined,
  key: string,
];

type UnkeyedGuardrailFactRow = [
  label: string,
  value: string,
  color?: string,
];

/**
 * Build descriptor-only inspector rows for a canonical guardrail report.
 *
 * Each returned row includes a deterministic key. Keys use the row label and
 * its occurrence so repeated classifier matches retain authored order without
 * colliding in React lists.
 */
export function guardrailReportRows(
  report: CruxGuardrailReportPreview,
): KeyedGuardrailFactRow[] {
  const rows: UnkeyedGuardrailFactRow[] = [];
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
  appendFindingRows(rows, report);
  if (report.matches?.length)
    rows.push(["matches", String(report.matches.length)]);
  return withStableKeys(rows);
}

function appendFindingRows(
  rows: UnkeyedGuardrailFactRow[],
  report: CruxGuardrailReportPreview,
): void {
  let genericCount = 0;
  for (const finding of report.findings ?? []) {
    if (
      finding.type === "media_classifier_match" &&
      finding.category !== undefined &&
      finding.score !== undefined &&
      finding.threshold !== undefined
    ) {
      rows.push([
        "match",
        `${finding.category} · ${formatEvidenceNumber(finding.score)} ≥ ${formatEvidenceNumber(finding.threshold)}`,
      ]);
    } else if (finding.type === "media_not_inspected") {
      rows.push([
        "inspection",
        "not inspected",
        "var(--devtools-warn)",
      ]);
    } else {
      genericCount += 1;
    }
  }
  if (genericCount > 0) rows.push(["findings", String(genericCount)]);
}

function withStableKeys(
  rows: readonly UnkeyedGuardrailFactRow[],
): KeyedGuardrailFactRow[] {
  const occurrences = new Map<string, number>();
  return rows.map(([label, value, color]) => {
    const occurrence = occurrences.get(label) ?? 0;
    occurrences.set(label, occurrence + 1);
    return [label, value, color, `${label}:${occurrence}`];
  });
}

function formatEvidenceNumber(value: number): string {
  const formatted = String(value);
  if (formatted.includes("e") || formatted.includes("E")) return formatted;
  const decimal = formatted.indexOf(".");
  if (decimal === -1) return `${formatted}.00`;
  const fractionalDigits = formatted.length - decimal - 1;
  return fractionalDigits >= 2
    ? formatted
    : `${formatted}${"0".repeat(2 - fractionalDigits)}`;
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
