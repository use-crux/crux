/**
 *
 * Turn Decision Report signal extraction for Eval execution.
 *
 * The report remains a read model, not a replacement trace format. Eval
 * only reads report previews when an execution records them as custom
 * artifacts, which lets authored assertions use the same contract as Devtools.
 *
 * @internal
 * @module
 */

import type { CruxArtifactRecord } from '../../../observability/contract'
import type { TurnDecisionReport } from '../../../observability/turn-decision-report'

/** Custom artifact kind used when a task emits a report preview for assertions. */
export const TURN_DECISION_REPORT_ARTIFACT_KIND = 'custom.turn_decision_report'

/** One captured decision report plus the span that emitted it. @internal */
export interface TurnDecisionReportSignal {
  /** Observability span that emitted the report preview. */
  spanId: string
  /** Report preview using the public `TurnDecisionReport` contract. */
  report: TurnDecisionReport
}

/** Extract structurally valid report previews from artifact records. @internal */
export function extractTurnDecisionReportSignals(records: readonly CruxArtifactRecord[]): TurnDecisionReportSignal[] {
  const reports: TurnDecisionReportSignal[] = []
  for (const record of records) {
    if (record.kind !== TURN_DECISION_REPORT_ARTIFACT_KIND || record.spanId === undefined) continue
    if (!isTurnDecisionReport(record.preview)) continue
    reports.push({ spanId: record.spanId, report: record.preview })
  }
  return reports
}

function isTurnDecisionReport(value: unknown): value is TurnDecisionReport {
  if (value === null || typeof value !== 'object') return false
  const report = value as Partial<TurnDecisionReport>
  return (
    report.schemaVersion === 1 &&
    typeof report.reportId === 'string' &&
    typeof report.runId === 'string' &&
    typeof report.turn === 'object' &&
    Array.isArray(report.saw) &&
    Array.isArray(report.considered) &&
    Array.isArray(report.decisions) &&
    typeof report.coverage === 'object' &&
    Array.isArray(report.gaps)
  )
}
