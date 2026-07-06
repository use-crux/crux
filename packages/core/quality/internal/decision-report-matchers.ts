/**
 * Runtime matchers for `ctx.expect.decisionReport`.
 *
 * Matchers assert stable machine fields from `TurnDecisionReport` and never
 * depend on human-facing reason text, so UI copy can evolve independently.
 *
 * @internal
 * @module
 */

import type {
  TurnDecision,
  TurnDecisionReasonCode,
  TurnFreshnessEvidence,
} from '../../observability/turn-decision-report'
import type {
  TurnDecisionReportExpect,
  TurnDecisionReportReasonOptions,
} from '../decision-report-expect'
import type { TurnDecisionReportSignal } from './decision-report-signals'

type SignalAssert = (
  matcher: string,
  pass: boolean,
  message: string,
  expected?: unknown,
  actual?: unknown,
  options?: { spanIds?: readonly string[] },
) => void

/** Build the report matcher namespace for one cell. @internal */
export function createDecisionReportExpect(input: {
  reports: readonly TurnDecisionReportSignal[]
  assertOn: SignalAssert
  requireCaptured: () => void
}): TurnDecisionReportExpect {
  return {
    context: {
      toHaveDisposition(subject, disposition, options) {
        input.requireCaptured()
        const match = findDecision(input.reports, {
          kind: 'context.disposition',
          subject,
          outcome: disposition,
          options,
          label: 'context',
        })
        input.assertOn(
          'decisionReport.context.toHaveDisposition',
          match.pass,
          match.message,
          { subject, disposition, ...(options?.reasonCode !== undefined ? { reasonCode: options.reasonCode } : {}) },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
    routing: {
      toHaveOutcome(subject, outcome, options) {
        input.requireCaptured()
        const match = findDecision(input.reports, {
          kindPrefix: 'routing.',
          subject,
          outcome,
          options,
          label: 'routing decision',
        })
        input.assertOn(
          'decisionReport.routing.toHaveOutcome',
          match.pass,
          match.message,
          { subject, outcome, ...(options?.reasonCode !== undefined ? { reasonCode: options.reasonCode } : {}) },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
    fallback: {
      toHaveFired(options) {
        input.requireCaptured()
        const match = findDecision(input.reports, {
          kindPrefix: 'routing.fallback',
          outcome: 'fired',
          options,
          label: 'fallback decision',
        })
        input.assertOn(
          'decisionReport.fallback.toHaveFired',
          match.pass,
          match.message,
          { outcome: 'fired', ...(options?.reasonCode !== undefined ? { reasonCode: options.reasonCode } : {}) },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
    freshness: {
      toHaveStatus(subject, status) {
        input.requireCaptured()
        const match = findFreshness(input.reports, subject, status)
        input.assertOn(
          'decisionReport.freshness.toHaveStatus',
          match.pass,
          match.message,
          { subject, status },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
    cache: {
      toHaveFreshnessAcceptance(subject, acceptance, options) {
        input.requireCaptured()
        const match = findCacheAcceptance(input.reports, subject, acceptance, options)
        input.assertOn(
          'decisionReport.cache.toHaveFreshnessAcceptance',
          match.pass,
          match.message,
          { subject, acceptance, ...(options?.reasonCode !== undefined ? { reasonCode: options.reasonCode } : {}) },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
    safety: {
      toHaveOutcome(policyId, outcome, options) {
        input.requireCaptured()
        const match = findDecision(input.reports, {
          kindPrefix: 'safety.',
          subject: policyId,
          outcome,
          options,
          label: 'safety decision',
        })
        input.assertOn(
          'decisionReport.safety.toHaveOutcome',
          match.pass,
          match.message,
          { policyId, outcome, ...(options?.reasonCode !== undefined ? { reasonCode: options.reasonCode } : {}) },
          match.actual,
          { spanIds: match.spanIds },
        )
      },
    },
  }
}

function findDecision(
  reports: readonly TurnDecisionReportSignal[],
  criteria: {
    kind?: string
    kindPrefix?: string
    subject?: string
    outcome: string
    options: TurnDecisionReportReasonOptions | undefined
    label: string
  },
): { pass: boolean; message: string; actual: unknown; spanIds: string[] } {
  const decisions = reports.flatMap((signal) =>
    signal.report.decisions
      .filter((decision) => decisionKindMatches(decision, criteria))
      .filter((decision) => criteria.subject === undefined || subjectMatches(decision, criteria.subject))
      .map((decision) => ({ signal, decision })),
  )
  const dispositions = decisions.map(({ decision }) => decision.outcome)
  const withDisposition = decisions.filter(({ decision }) => decision.outcome === criteria.outcome)
  const reasonCode = criteria.options?.reasonCode
  const withReason = reasonCode === undefined ? withDisposition : withDisposition.filter(({ decision }) => decision.reason.code === reasonCode)

  if (withReason.length > 0) {
    return {
      pass: true,
      message: '',
      actual: withReason.map(({ decision }) => decisionSummary(decision)),
      spanIds: withReason.map(({ signal }) => signal.spanId),
    }
  }

  const reasonCodes = withDisposition.map(({ decision }) => decision.reason.code)
  return {
    pass: false,
    message:
      decisions.length === 0
        ? missingDecisionMessage(criteria)
        : reasonCode !== undefined && withDisposition.length > 0
          ? `expected ${criteria.label} to have reason code '${reasonCode}'; got [${reasonCodes.join(', ')}]`
          : `expected ${criteria.label} to have outcome '${criteria.outcome}'; got [${dispositions.join(', ')}]`,
    actual: decisions.map(({ decision }) => decisionSummary(decision)),
    spanIds: decisions.map(({ signal }) => signal.spanId),
  }
}

function decisionKindMatches(
  decision: TurnDecision,
  criteria: { kind?: string; kindPrefix?: string },
): boolean {
  if (criteria.kind !== undefined) return decision.kind === criteria.kind
  if (criteria.kindPrefix !== undefined) return decision.kind.startsWith(criteria.kindPrefix)
  return true
}

function missingDecisionMessage(criteria: { label: string; subject?: string; outcome: string }): string {
  if (criteria.subject !== undefined) {
    return `expected ${criteria.label} '${criteria.subject}' to have outcome '${criteria.outcome}', but no decision matched`
  }
  return `expected ${criteria.label} to have outcome '${criteria.outcome}', but no decision matched`
}

function findFreshness(
  reports: readonly TurnDecisionReportSignal[],
  subject: string,
  status: TurnFreshnessEvidence['status'],
): { pass: boolean; message: string; actual: unknown; spanIds: string[] } {
  const rows = reports.flatMap((signal) =>
    signal.report.freshness
      .filter((row) => subjectMatchesEvidence(row.subject, subject))
      .map((row) => ({ signal, row })),
  )
  const matching = rows.filter(({ row }) => row.status === status)
  return {
    pass: matching.length > 0,
    message:
      rows.length === 0
        ? `expected freshness for '${subject}' to have status '${status}', but no freshness row matched`
        : `expected freshness for '${subject}' to have status '${status}'; got [${rows
            .map(({ row }) => row.status)
            .join(', ')}]`,
    actual: rows.map(({ row }) => ({ subject: row.subject.id ?? row.subject.name, status: row.status })),
    spanIds: rows.map(({ signal }) => signal.spanId),
  }
}

function findCacheAcceptance(
  reports: readonly TurnDecisionReportSignal[],
  subject: string,
  acceptance: 'accepted' | 'rejected',
  options: TurnDecisionReportReasonOptions | undefined,
): { pass: boolean; message: string; actual: unknown; spanIds: string[] } {
  const rows = reports.flatMap((signal) =>
    signal.report.cache.filter((row) => subjectMatchesEvidence(row.subject, subject)).map((row) => ({ signal, row })),
  )
  const accepted = acceptance === 'accepted'
  const matching = rows.filter(({ row }) =>
    accepted ? row.acceptedByFreshness === true : row.rejectedByFreshness === true,
  )
  const reasonCode = options?.reasonCode
  const relatedDecisions = reports.flatMap((signal) =>
    signal.report.decisions
      .filter((decision) => decision.cache !== undefined || decision.kind.includes('cache'))
      .filter((decision) => subjectMatches(decision, subject))
      .map((decision) => ({ signal, decision })),
  )
  const reasonMatches =
    reasonCode === undefined || relatedDecisions.some(({ decision }) => decision.reason.code === reasonCode)

  return {
    pass: matching.length > 0 && reasonMatches,
    message:
      rows.length === 0
        ? `expected cache for '${subject}' to be ${acceptance} by freshness, but no cache row matched`
        : reasonCode !== undefined && !reasonMatches
          ? `expected cache for '${subject}' to have reason code '${reasonCode}'`
          : `expected cache for '${subject}' to be ${acceptance} by freshness`,
    actual: rows.map(({ row }) => ({
      subject: row.subject.id ?? row.subject.name,
      status: row.status,
      acceptedByFreshness: row.acceptedByFreshness,
      rejectedByFreshness: row.rejectedByFreshness,
    })),
    spanIds: [...rows.map(({ signal }) => signal.spanId), ...relatedDecisions.map(({ signal }) => signal.spanId)],
  }
}

function subjectMatches(decision: TurnDecision, subject: string): boolean {
  return subjectMatchesEvidence(decision.subject, subject)
}

function subjectMatchesEvidence(subject: { id?: string; name?: string; label?: string }, expected: string): boolean {
  return subject.id === expected || subject.name === expected || subject.label === expected
}

function decisionSummary(decision: TurnDecision): {
  subject?: string
  outcome: string
  reasonCode: TurnDecisionReasonCode
} {
  return {
    subject: decision.subject.id ?? decision.subject.name ?? decision.subject.label,
    outcome: decision.outcome,
    reasonCode: decision.reason.code,
  }
}
