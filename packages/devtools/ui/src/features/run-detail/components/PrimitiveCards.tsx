/**
 * Long-tail polymorphic detail cards, bound to the canonical typed
 * `artifact.preview` reports the backend now emits (contract `Crux*ReportPreview`).
 *
 * These primitives previously fell through to a bare Output tab; each card here
 * renders the substance of its report. Content only — facts/quality stay in the
 * Inspector. Every card degrades to an `EmptyHint` when its report is absent
 * (Output remains available as a secondary tab, so nothing is lost).
 *
 * Design refs: `v8` CardEval · `v12` CardRouting/CardCache/CardCompaction/
 * CardConstraint/CardSecurity · `v8` CardCorpus/CardGuardrail.
 */

import { Fragment, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { JsonTree } from '@/shared/components/JsonTree'
import { Chip, Eyebrow, ScoreBar, type ChipTone } from '@/qw/shell/primitives'
import type {
  CruxCacheReportPreview,
  CruxCompactionReportPreview,
  CruxCompositionReportPreview,
  CruxConstraintReportPreview,
  CruxCorpusReportPreview,
  CruxGuardrailReportPreview,
  CruxIndexingReportPreview,
  CruxIngestReportPreview,
  CruxRoutingReportPreview,
  CruxScoreReportPreview,
  CruxSecurityReportPreview,
  CruxSourceStageCountsPreview,
} from '@use-crux/core/observability'
import type { ObservabilityRunDetailNode } from '@/types'
import { CardShell, EmptyHint, KeyValue } from './SpanDetailPanelAtoms'
import { KindTag } from './atoms'
import { primitiveAccentVar } from '../lib/families'
import { evalCasesOf } from '../lib/archetype'
import {
  classifyPrimitive,
  findArtifact,
  findAttribute,
  fmtCost,
  fmtDuration,
  fmtTokens,
  gatherDescendants,
  nodeDuration,
  statusLabel,
  statusTone,
} from '../lib/span-detail-inspection'

// ─── typed-preview narrowing ────────────────────────────────────────

function reportOfKind<K extends string>(preview: unknown, kind: K): boolean {
  return typeof preview === 'object' && preview !== null && (preview as { kind?: unknown }).kind === kind
}

/** Section header (design `Sec`/`SecHead`): eyebrow + rule + optional right slot. */
function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>{title}</Eyebrow>
        <div className="h-px flex-1" style={{ background: 'var(--qw-border)' }} />
        {right}
      </div>
      {children}
    </div>
  )
}

// ─── Eval / scoring (verdict + judges + expected/actual) ────────────

export function EvalCard({ node }: { node: ObservabilityRunDetailNode }) {
  const raw = findArtifact(node, 'score.report')?.preview
  if (!reportOfKind(raw, 'score.report')) {
    return <EmptyHint>No verdict / judge report recorded for this case.</EmptyHint>
  }
  const report = raw as CruxScoreReportPreview
  const verdict = report.verdict
  const pass = verdict === 'pass'
  const judges = report.judges ?? []

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label="Verdict"
        right={
          report.primaryFailureType ? (
            <span style={{ color: 'var(--qw-danger)' }}>{report.primaryFailureType}</span>
          ) : undefined
        }
      >
        <div className="flex items-center gap-3 px-3.5 py-3">
          <Chip tone={pass ? 'ok' : verdict ? 'danger' : 'muted'} dot>
            {verdict != null ? String(verdict) : '—'}
          </Chip>
          {report.score != null && (
            <span className="font-mono text-[13px] font-semibold">{report.score.toFixed(2)}</span>
          )}
          {report.reasoningPreview && (
            <span className="flex-1 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {report.reasoningPreview}
            </span>
          )}
        </div>
      </CardShell>

      {judges.length > 0 && (
        <CardShell label={`Judges · ${judges.length}`}>
          <div className="flex flex-col gap-2.5 px-3.5 py-3">
            {judges.map((j) => {
              const ok = j.status === 'passed' || (j.score != null && j.threshold != null && j.score >= j.threshold)
              const color = ok ? 'var(--qw-ok)' : 'var(--qw-warn)'
              return (
                <div key={j.name}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex-1 truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }}>
                      {j.name}
                    </span>
                    {j.score != null && (
                      <span className="font-mono text-[11.5px] font-semibold" style={{ color }}>
                        {j.score.toFixed(2)}
                        {j.threshold != null && (
                          <span style={{ color: 'var(--qw-fg-faint)' }}> / {j.threshold.toFixed(2)}</span>
                        )}
                      </span>
                    )}
                  </div>
                  {j.score != null && <ScoreBar score={j.score} threshold={j.threshold} color={color} />}
                  {j.rationale && (
                    <div className="mt-1 text-[11.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
                      {j.rationale}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardShell>
      )}

      {(report.expected !== undefined || report.actual !== undefined) && (
        <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <CardShell label="Expected">
            <div className="px-3.5 py-3">
              {report.expected !== undefined ? <JsonTree data={report.expected} /> : <Empty />}
            </div>
          </CardShell>
          <CardShell label="Actual">
            <div className="px-3.5 py-3">
              {report.actual !== undefined ? <JsonTree data={report.actual} /> : <Empty />}
            </div>
          </CardShell>
        </div>
      )}
    </div>
  )
}

// ─── Eval run roll-up (this run's cases — design `ArchEval`) ────────
//
// The *root* eval.run view: aggregate pass-rate + a row per `eval.case`
// child, each drilling to that case (Tree + spanId). Content-only, so it
// mounts both in the detail pane and full-bleed as the Summary landing.
// (A single case still renders `EvalCard`.) Cross-variant matrix stays in
// the experiments feature — this is "this run's cases", not cases × variants.

export function EvalRunCard({ node, onSelect }: { node: ObservabilityRunDetailNode; onSelect: (id: string) => void }) {
  const cases = evalCasesOf(node)
  if (cases.length === 0) {
    return <EmptyHint>No eval cases recorded for this run yet — see the Output / structure.</EmptyHint>
  }
  const passed = cases.filter((c) => c.pass).length
  const pct = Math.round((passed / cases.length) * 100)
  const tone: ChipTone = pct >= 80 ? 'ok' : pct >= 50 ? 'warn' : 'danger'

  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={`Cases · ${cases.length}`}
        right={
          <Chip tone={tone} mono>
            {pct}% pass
          </Chip>
        }
      >
        <div className="px-3.5 py-3">
          <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--qw-danger-soft)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--qw-ok)' }} />
          </div>
          <div className="mt-1.5 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {passed} / {cases.length} passed
          </div>
        </div>
      </CardShell>

      <CardShell label="Results">
        <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
          {cases.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className="grid items-center gap-2.5 px-3.5 py-2 text-left transition-opacity hover:opacity-90"
              style={{ background: 'var(--qw-bg-elev)', gridTemplateColumns: '1fr 78px 92px 48px' }}
            >
              <span className="truncate font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }}>
                {c.name}
              </span>
              <Chip tone={c.pass ? 'ok' : c.verdict ? 'danger' : 'muted'} dot>
                {c.verdict ?? '—'}
              </Chip>
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {c.judgesTotal != null ? `${c.judgesPassed ?? 0}/${c.judgesTotal} judges` : ''}
              </span>
              <span
                className="text-right font-mono text-[11.5px] font-semibold"
                style={{ color: 'var(--qw-fg-muted)' }}
              >
                {c.score != null ? c.score.toFixed(2) : ''}
              </span>
            </button>
          ))}
        </div>
      </CardShell>
    </div>
  )
}

// ─── Operation reports (routing / cache / compaction / guardrail /
//     constraint / security / corpus / indexing / ingest) ───────────

const OPERATION_REPORT_KINDS = [
  'routing.report',
  'cache.report',
  'compaction.report',
  'guardrail.report',
  'constraint.report',
  'security.report',
  'corpus.report',
  'indexing.report',
  'ingest.report',
] as const

/** First operation report present on the node (typed by its `kind`). */
function findOperationReport(node: ObservabilityRunDetailNode): { kind: string; preview: unknown } | null {
  for (const kind of OPERATION_REPORT_KINDS) {
    const preview = findArtifact(node, kind)?.preview
    if (preview !== undefined && reportOfKind(preview, kind)) return { kind, preview }
  }
  return null
}

export function OperationReportCard({ node }: { node: ObservabilityRunDetailNode }) {
  const found = findOperationReport(node)
  if (!found) return <EmptyHint>No structured report for this operation yet — see the Output tab.</EmptyHint>

  switch (found.kind) {
    case 'routing.report':
      return <RoutingReport report={found.preview as CruxRoutingReportPreview} />
    case 'cache.report':
      return <CacheReport report={found.preview as CruxCacheReportPreview} />
    case 'compaction.report':
      return <CompactionReport report={found.preview as CruxCompactionReportPreview} />
    case 'guardrail.report':
      return <GuardrailReport report={found.preview as CruxGuardrailReportPreview} />
    case 'constraint.report':
      return <ConstraintReport report={found.preview as CruxConstraintReportPreview} />
    case 'security.report':
      return <SecurityReport report={found.preview as CruxSecurityReportPreview} />
    case 'corpus.report':
      return <CorpusReport report={found.preview as CruxCorpusReportPreview} />
    case 'indexing.report':
      return <IndexingReport report={found.preview as CruxIndexingReportPreview} />
    case 'ingest.report':
      return <IngestReport report={found.preview as CruxIngestReportPreview} />
    default:
      return <EmptyHint>Unknown report.</EmptyHint>
  }
}

/** Render a *specific* report kind's card (used by per-type governance tabs). */
export function OperationReportFor({ node, kind }: { node: ObservabilityRunDetailNode; kind: string }) {
  const preview = findArtifact(node, kind)?.preview
  if (preview === undefined || !reportOfKind(preview, kind)) {
    return <EmptyHint>No {kind.replace('.report', '')} report on this span.</EmptyHint>
  }
  switch (kind) {
    case 'routing.report':
      return <RoutingReport report={preview as CruxRoutingReportPreview} />
    case 'cache.report':
      return <CacheReport report={preview as CruxCacheReportPreview} />
    case 'compaction.report':
      return <CompactionReport report={preview as CruxCompactionReportPreview} />
    case 'guardrail.report':
      return <GuardrailReport report={preview as CruxGuardrailReportPreview} />
    case 'constraint.report':
      return <ConstraintReport report={preview as CruxConstraintReportPreview} />
    case 'security.report':
      return <SecurityReport report={preview as CruxSecurityReportPreview} />
    case 'corpus.report':
      return <CorpusReport report={preview as CruxCorpusReportPreview} />
    case 'indexing.report':
      return <IndexingReport report={preview as CruxIndexingReportPreview} />
    case 'ingest.report':
      return <IngestReport report={preview as CruxIngestReportPreview} />
    default:
      return <EmptyHint>Unknown report.</EmptyHint>
  }
}

function RoutingReport({ report }: { report: CruxRoutingReportPreview }) {
  const tiers = report.tiers ?? []
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Cascade · escalating tiers"
        right={
          report.chosen ? (
            <Chip tone="ok" mono>
              {report.chosen}
            </Chip>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2">
          {tiers.map((t, i) => {
            const v = String(t.verdict ?? '')
            const accepted = v === 'accepted'
            const skipped = v === 'skipped' || v === 'not-reached'
            const note = (t as { note?: string }).note ?? (t as { reason?: string }).reason
            return (
              <div
                key={t.tier ?? i}
                className="flex items-center gap-2.5 rounded-[8px] px-3 py-2.5"
                style={{
                  background: 'var(--qw-bg-elev)',
                  border: `1px solid ${accepted ? 'var(--qw-ok-soft)' : 'var(--qw-border)'}`,
                  opacity: skipped ? 0.55 : 1,
                }}
              >
                <span className="w-4 font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                  {i + 1}
                </span>
                <span className="w-[120px] truncate font-mono text-[12px] font-semibold">{t.model}</span>
                <span className="w-16 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {t.budget != null ? fmtCost(t.budget) : ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {note}
                </span>
                <VerdictChip verdict={t.verdict} />
              </div>
            )
          })}
        </div>
      </Section>
      {(report.classifiedAs || report.fallbackReason) && (
        <div
          className="rounded-[8px] px-3 py-2.5 font-mono text-[11.5px]"
          style={{ border: '1px dashed var(--qw-border)', color: 'var(--qw-fg-muted)' }}
        >
          {report.classifiedAs ? `classified → ${report.classifiedAs}. ` : ''}
          {report.fallbackReason ?? ''}
        </div>
      )}
    </div>
  )
}

function VerdictChip({ verdict }: { verdict?: string }) {
  if (!verdict) return <span />
  const tone: ChipTone =
    verdict === 'accepted' ? 'ok' : verdict === 'rejected' || verdict === 'error' ? 'warn' : 'muted'
  return (
    <Chip tone={tone} dot>
      {verdict}
    </Chip>
  )
}

function CacheReport({ report }: { report: CruxCacheReportPreview }) {
  const hit = report.status === 'hit'
  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex items-center gap-2.5 rounded-[8px] px-3.5 py-3"
        style={{ background: hit ? 'var(--qw-ok-soft)' : 'var(--qw-bg-muted)' }}
      >
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color: hit ? 'var(--qw-ok)' : 'var(--qw-fg)' }}>
            Cache {report.status}
          </div>
          <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {hit
              ? 'An equivalent request was found — the downstream generation was skipped.'
              : 'No cached equivalent — the downstream call ran.'}
          </div>
        </div>
      </div>
      {report.saved && (
        <Section title="Saved by this hit">
          <div className="grid gap-2.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
            {(
              [
                ['tokens saved', fmtTokens(report.saved.tokens)],
                ['cost saved', fmtCost(report.saved.costUsd)],
                ['latency saved', fmtDuration(report.saved.latencyMs)],
              ] as const
            ).map(([k, v]) => (
              <div
                key={k}
                className="rounded-[8px] px-3 py-2.5"
                style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
              >
                <div className="font-mono text-[17px] font-bold" style={{ color: 'var(--qw-ok)' }}>
                  {v}
                </div>
                <div className="mt-0.5 text-[10px] uppercase" style={{ color: 'var(--qw-fg-faint)' }}>
                  {k}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function CompactionReport({ report }: { report: CruxCompactionReportPreview }) {
  const before = report.beforeTokens ?? 0
  const after = report.afterTokens ?? 0
  const pct =
    report.compressionRatio != null
      ? Math.round(report.compressionRatio * 100)
      : before > 0
        ? Math.round((1 - after / before) * 100)
        : undefined
  const afterW = before > 0 ? Math.max(4, Math.min(100, (after / before) * 100)) : 100
  return (
    <div className="flex flex-col gap-5">
      <Section
        title="History compacted to fit budget"
        right={
          pct != null ? (
            <Chip tone="ok" mono>
              −{pct}%
            </Chip>
          ) : undefined
        }
      >
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="mb-1 text-[10px] uppercase" style={{ color: 'var(--qw-fg-faint)' }}>
              before · {fmtTokens(before)}
            </div>
            <div className="h-[18px] rounded-[4px]" style={{ background: 'var(--qw-warn)', opacity: 0.7 }} />
          </div>
          <span style={{ color: 'var(--qw-fg-faint)' }}>→</span>
          <div className="flex-1">
            <div className="mb-1 text-[10px] uppercase" style={{ color: 'var(--qw-fg-faint)' }}>
              after · {fmtTokens(after)}
            </div>
            <div
              className="h-[18px] rounded-[4px]"
              style={{ width: `${afterW}%`, background: 'var(--qw-ok)', opacity: 0.8 }}
            />
          </div>
        </div>
      </Section>
      {report.summarizedPreview && (
        <Section title="Summarized out">
          <div
            className="whitespace-pre-wrap rounded-[8px] px-3.5 py-3 text-[12px] leading-[1.6]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
              fontFamily: 'var(--qw-serif)',
            }}
          >
            {report.summarizedPreview}
          </div>
        </Section>
      )}
    </div>
  )
}

function GuardrailReport({ report }: { report: CruxGuardrailReportPreview }) {
  const blocked = report.action === 'block'
  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={`Guardrail${report.phase ? ` · ${report.phase}` : ''}`}
        right={
          <Chip tone={blocked ? 'danger' : report.action === 'pass' ? 'ok' : 'warn'} dot>
            {report.action}
          </Chip>
        }
      >
        {report.reason && (
          <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {report.reason}
          </div>
        )}
      </CardShell>
      {report.matches && report.matches.length > 0 && (
        <CardShell label={`Matches · ${report.matches.length}`}>
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {report.matches.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3.5 py-2 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg-elev)' }}
              >
                {m.kind && <span style={{ color: 'var(--qw-fg-faint)' }}>{m.kind}</span>}
                {m.from && (
                  <span className="line-through" style={{ color: 'var(--qw-danger)' }}>
                    {m.from}
                  </span>
                )}
                {m.to && (
                  <>
                    <span style={{ color: 'var(--qw-fg-faint)' }}>→</span>
                    <span style={{ color: 'var(--qw-ok)' }}>{m.to}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardShell>
      )}
    </div>
  )
}

function ConstraintReport({ report }: { report: CruxConstraintReportPreview }) {
  const attempts = report.attempts ?? []
  const passN = attempts.find((a) => a.status === 'pass')?.n
  const assertion = report.assertion ?? report.constraint
  return (
    <div className="flex flex-col gap-5">
      {assertion && (
        <Section title="Assertion">
          <div
            className="rounded-[8px] px-3.5 py-2.5 font-mono text-[11.5px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            {assertion}
          </div>
        </Section>
      )}
      {attempts.length > 0 && (
        <Section
          title="Retry chain"
          right={
            <Chip tone={report.pass ? 'ok' : 'danger'} dot>
              {passN != null ? `passed on attempt ${passN}` : report.pass ? 'passed' : 'failed'}
            </Chip>
          }
        >
          <div className="flex flex-col">
            {attempts.map((a, i) => {
              const ok = a.status === 'pass'
              const note = (a as { note?: string }).note
              return (
                <div key={a.n ?? i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className="flex size-[26px] items-center justify-center rounded-full font-mono text-[11px] font-bold"
                      style={{
                        background: ok ? 'var(--qw-ok-soft)' : 'var(--qw-danger-soft)',
                        color: ok ? 'var(--qw-ok)' : 'var(--qw-danger)',
                      }}
                    >
                      {a.n ?? i + 1}
                    </div>
                    {i < attempts.length - 1 && (
                      <div className="w-0.5 flex-1" style={{ background: 'var(--qw-border)', minHeight: 20 }} />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[12px] font-semibold">attempt {a.n ?? i + 1}</span>
                      <Chip tone={ok ? 'ok' : a.status === 'fail' ? 'danger' : 'warn'} dot>
                        {a.status}
                      </Chip>
                    </div>
                    {note && (
                      <div className="text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
                        {note}
                      </div>
                    )}
                    {a.feedback && (
                      <div
                        className="mt-1.5 rounded-[8px] px-3 py-2 text-[11.5px]"
                        style={{ background: 'var(--qw-warn-soft)', color: 'var(--qw-fg)' }}
                      >
                        <span
                          className="font-mono text-[9.5px] uppercase tracking-[0.06em]"
                          style={{ color: 'var(--qw-warn)' }}
                        >
                          feedback → next attempt
                        </span>
                        <div className="mt-0.5">{a.feedback}</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

function SecurityReport({ report }: { report: CruxSecurityReportPreview }) {
  const danger = report.severity === 'error'
  const color = danger ? 'var(--qw-danger)' : 'var(--qw-warn)'
  const bg = danger ? 'var(--qw-danger-soft)' : 'var(--qw-warn-soft)'
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5 rounded-[8px] px-3.5 py-3" style={{ background: bg }}>
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color }}>
            {report.pattern}
            {report.severity ? ` · ${report.severity}` : ''}
          </div>
          {report.message && (
            <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
              {report.message}
            </div>
          )}
        </div>
        {report.action && (
          <Chip tone="warn" dot>
            {report.action}
          </Chip>
        )}
      </div>
      {(report.location || report.preview) && (
        <Section title="Matched in">
          <div
            className="rounded-[8px] px-3.5 py-2.5"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            {report.location && (
              <div className="mb-1.5 font-mono text-[11px]" style={{ color: 'var(--qw-crux)' }}>
                {report.location}
              </div>
            )}
            {report.preview && (
              <div
                className="text-[12.5px] leading-[1.55]"
                style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}
              >
                {report.preview}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

// ─── indexing throughput (design `ArchIndexing`) ────────────────────

const STAGE_ORDER = ['parse', 'chunk', 'embed', 'store'] as const
const STAGE_UNIT: Record<string, string> = { parse: 'sources', chunk: 'chunks', embed: 'vectors', store: 'upserts' }

/** parse → chunk → embed → store pipeline funnel. */
function PipelineFunnel({ stages }: { stages: CruxSourceStageCountsPreview }) {
  const known = STAGE_ORDER.filter((k) => typeof stages[k] === 'number')
  const extra = Object.keys(stages).filter(
    (k) => !STAGE_ORDER.includes(k as (typeof STAGE_ORDER)[number]) && typeof stages[k] === 'number',
  )
  const ordered: string[] = [...known, ...extra]
  if (ordered.length === 0) return null
  return (
    <Section title="Pipeline">
      <div className="flex items-stretch">
        {ordered.map((name, i) => (
          <Fragment key={name}>
            {i > 0 && (
              <div
                className="flex w-8 shrink-0 items-center justify-center text-[13px]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                →
              </div>
            )}
            <div
              className="flex-1 rounded-[10px] px-3.5 py-3"
              style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
            >
              <div
                className="font-mono text-[10px] uppercase tracking-[0.06em]"
                style={{ color: 'var(--qw-fg-faint)' }}
              >
                {name}
              </div>
              <div className="mt-0.5 font-mono text-[18px] font-bold">{(stages[name] ?? 0).toLocaleString()}</div>
              <div className="text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {STAGE_UNIT[name] ?? ''}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
    </Section>
  )
}

const OUTCOME_KEYS = ['added', 'changed', 'unchanged', 'skipped', 'failed', 'stale', 'deleted'] as const
const OUTCOME_TONE: Record<string, string> = {
  added: 'var(--qw-ok)',
  changed: 'var(--qw-crux)',
  unchanged: 'var(--qw-fg-muted)',
  skipped: 'var(--qw-fg-muted)',
  failed: 'var(--qw-danger)',
  stale: 'var(--qw-warn)',
  deleted: 'var(--qw-fg-muted)',
}

/** Sync-outcome tiles, colored by outcome (design `ArchIndexing`). */
function OutcomeTiles({ totals }: { totals: Record<string, number | undefined> }) {
  const entries = OUTCOME_KEYS.filter((k) => typeof totals[k] === 'number')
  if (entries.length === 0) return null
  return (
    <Section title="Sync outcome">
      <div
        className="grid gap-2.5"
        style={{ gridTemplateColumns: `repeat(${Math.min(entries.length, 5)}, minmax(0, 1fr))` }}
      >
        {entries.map((k) => (
          <div
            key={k}
            className="rounded-[8px] px-3 py-2.5"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div className="font-mono text-[19px] font-bold" style={{ color: OUTCOME_TONE[k] }}>
              {(totals[k] ?? 0).toLocaleString()}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-faint)' }}>
              {k}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}

function SourceRows({
  sources,
}: {
  sources: readonly { id: string; action: string; reason?: string; chunks?: number }[]
}) {
  if (sources.length === 0) return null
  return (
    <CardShell label={`Sources · ${sources.length}`}>
      <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
        {sources.slice(0, 40).map((s) => {
          const failed = s.action === 'failed'
          return (
            <div
              key={s.id}
              className="grid items-center gap-2 px-3.5 py-1.5 font-mono text-[11px]"
              style={{
                background: failed ? 'var(--qw-danger-soft)' : 'var(--qw-bg-elev)',
                gridTemplateColumns: '1fr 90px 60px',
              }}
            >
              <div className="min-w-0">
                <div className="truncate" style={{ color: 'var(--qw-fg)' }}>
                  {s.id}
                </div>
                {s.reason && (
                  <div
                    className="truncate text-[10px]"
                    style={{ color: failed ? 'var(--qw-danger)' : 'var(--qw-fg-faint)' }}
                  >
                    {s.reason}
                  </div>
                )}
              </div>
              <Chip tone={failed ? 'danger' : 'muted'} mono>
                {s.action}
              </Chip>
              <span className="text-right" style={{ color: 'var(--qw-fg-muted)' }}>
                {s.chunks != null ? `${s.chunks} ch` : ''}
              </span>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

function CorpusReport({ report }: { report: CruxCorpusReportPreview }) {
  return (
    <div className="flex flex-col gap-5">
      <Eyebrow>Corpus sync{report.mode ? ` · ${report.mode}` : ''}</Eyebrow>
      {report.stageCounts && <PipelineFunnel stages={report.stageCounts} />}
      <OutcomeTiles totals={report.totals} />
      <SourceRows sources={report.sources} />
    </div>
  )
}

function IndexingReport({ report }: { report: CruxIndexingReportPreview }) {
  return (
    <div className="flex flex-col gap-5">
      <Eyebrow>Indexing · {report.operation}</Eyebrow>
      {report.stageCounts && <PipelineFunnel stages={report.stageCounts} />}
      <OutcomeTiles totals={report.totals} />
      {report.sources && <SourceRows sources={report.sources} />}
    </div>
  )
}

function IngestReport({ report }: { report: CruxIngestReportPreview }) {
  return (
    <CardShell
      label="Ingest"
      right={
        <Chip tone={report.status === 'success' ? 'ok' : 'danger'} dot>
          {report.status}
        </Chip>
      }
    >
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <KeyValue k="source" v={report.sourceId} />
        {report.parser && <KeyValue k="parser" v={report.parser} />}
        {report.parts != null && <KeyValue k="parts" v={String(report.parts)} />}
        {report.chunks != null && <KeyValue k="chunks" v={String(report.chunks)} />}
        {report.warningCount != null && <KeyValue k="warnings" v={String(report.warningCount)} />}
        {report.reason && <KeyValue k="reason" v={report.reason} />}
      </div>
    </CardShell>
  )
}

// ─── Agent run (instructions · tools-available · react loop) ────────

// React loop renders as an indented tree up to 3 levels deep (design
// `CardAgent` + the user's nesting ask); deeper steps still drill in.
const AGENT_LOOP_MAX_DEPTH = 2

function AgentLoopRow({
  node,
  onSelect,
  depth,
}: {
  node: ObservabilityRunDetailNode
  onSelect: (id: string) => void
  depth: number
}) {
  const accent = primitiveAccentVar(node.primitive)
  const kids = node.children ?? []
  const showKids = depth < AGENT_LOOP_MAX_DEPTH && kids.length > 0
  const dotColor =
    node.status === 'error'
      ? 'var(--qw-danger)'
      : node.status === 'running'
        ? 'var(--qw-crux)'
        : node.status === 'stale'
          ? 'var(--qw-warn)'
          : undefined
  return (
    <>
      <button
        onClick={() => onSelect(node.id)}
        className="flex w-full min-w-0 items-center gap-2.5 py-2 text-left transition-opacity hover:opacity-90"
        style={{ paddingLeft: depth * 18 }}
      >
        <span className="size-[8px] shrink-0 rounded-full" style={{ background: accent }} />
        <KindTag kind={classifyPrimitive(node.primitive)} primitive={node.primitive} size={8.5} />
        <span className="truncate font-mono text-[12px] font-medium">
          {node.display?.label ?? node.name ?? node.primitive}
        </span>
        {dotColor && <span className="size-[5px] shrink-0 rounded-full" style={{ background: dotColor }} />}
        <div className="flex-1" />
        {!showKids && kids.length > 0 && (
          <span className="shrink-0 font-mono text-[9.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            +{kids.length}
          </span>
        )}
        <span
          className="shrink-0 text-right font-mono text-[10.5px]"
          style={{ color: 'var(--qw-fg-faint)', width: 50 }}
        >
          {fmtDuration(nodeDuration(node))}
        </span>
      </button>
      {showKids && kids.map((k) => <AgentLoopRow key={k.id} node={k} onSelect={onSelect} depth={depth + 1} />)}
    </>
  )
}

const INSTRUCTIONS_PREVIEW = 280

/** The agent's system prompt: a direct attribute when present, else the
 *  resolved base prompt of the first generation descendant (the live runs
 *  carry the system prompt on the generation's `request.basePrompt`, not the
 *  agent span). */
function agentInstructions(node: ObservabilityRunDetailNode): string | undefined {
  const direct = findAttribute(node, 'instructions', 'systemPrompt', 'system', 'prompt', 'instruction')
  if (typeof direct === 'string' && direct.trim()) return direct
  const gen = gatherDescendants(node).find((n) => (n.primitive ?? '').startsWith('generation'))
  const text = gen?.request?.basePrompt?.text
  return typeof text === 'string' && text.trim() ? text : undefined
}

export function AgentCard({ node, onSelect }: { node: ObservabilityRunDetailNode; onSelect: (id: string) => void }) {
  const [insOpen, setInsOpen] = useState(false)
  const instructionsText = agentInstructions(node)
  const insLong = (instructionsText?.length ?? 0) > INSTRUCTIONS_PREVIEW

  const children = node.children ?? []
  // `used` is inferred from the loop's descendants (their `toolName`); the
  // declared set comes from the agent's attributes (`toolNames` is the live key)
  // when present, else we show just the used tools.
  const used = new Set(
    gatherDescendants(node)
      .map((n) => n.toolName)
      .filter((t): t is string => !!t),
  )
  const availableRaw = findAttribute(node, 'toolNames', 'toolsAvailable', 'tools')
  const available = Array.isArray(availableRaw) ? availableRaw.filter((t): t is string => typeof t === 'string') : []
  const toolNames = Array.from(new Set([...available, ...used]))

  return (
    <div className="flex flex-col gap-5">
      {instructionsText && (
        <Section
          title="Instructions"
          right={
            <Chip tone="muted" mono>
              react loop
            </Chip>
          }
        >
          <div
            className="rounded-[8px] px-3.5 py-3"
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
          >
            <div
              className="whitespace-pre-wrap text-[12.5px] leading-[1.55]"
              style={{ fontFamily: 'var(--qw-serif)', color: 'var(--qw-fg-muted)' }}
            >
              {insLong && !insOpen ? instructionsText.slice(0, INSTRUCTIONS_PREVIEW).trimEnd() + '…' : instructionsText}
            </div>
            {insLong && (
              <button
                type="button"
                onClick={() => setInsOpen((o) => !o)}
                className="mt-1.5 font-mono text-[10.5px]"
                style={{ color: 'var(--qw-crux)' }}
              >
                {insOpen ? 'show less' : 'show more'}
              </button>
            )}
          </div>
        </Section>
      )}

      {toolNames.length > 0 && (
        <Section
          title="Tools available"
          right={
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              {used.size} of {toolNames.length} used
            </span>
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {toolNames.map((t) => {
              const isUsed = used.has(t)
              return (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    background: isUsed ? 'var(--qw-bg-elev)' : 'transparent',
                    color: isUsed ? 'var(--qw-fg)' : 'var(--qw-fg-faint)',
                    border: `1px ${isUsed ? 'solid' : 'dashed'} var(--qw-border)`,
                  }}
                  title={isUsed ? `${t} · used` : `${t} · available (not used)`}
                >
                  {t}
                  {isUsed && <span className="size-[5px] rounded-full" style={{ background: 'var(--qw-ok)' }} />}
                </span>
              )
            })}
          </div>
        </Section>
      )}

      {/* React loop — indented tree (up to 3 levels): dot · kind tag · step
          name · status dot · duration. Each step drills in; deeper than 3
          levels shows a `+N` count and drills in. */}
      <Section
        title="Loop"
        right={
          <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {children.length} step{children.length === 1 ? '' : 's'}
          </span>
        }
      >
        {children.length === 0 ? (
          <div className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
            (no steps recorded)
          </div>
        ) : (
          <div className="flex flex-col">
            {children.map((c) => (
              <AgentLoopRow key={c.id} node={c} onSelect={onSelect} depth={0} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

// ─── Composition (swarm / consensus / parallel / pipeline) ──────────

export function CompositionCard({ node }: { node: ObservabilityRunDetailNode }) {
  const raw = findArtifact(node, 'composition.report')?.preview
  if (!reportOfKind(raw, 'composition.report')) {
    return <EmptyHint>No composition report — see the structure (tree / graph) for the agents.</EmptyHint>
  }
  const report = raw as CruxCompositionReportPreview
  return (
    <div className="flex flex-col gap-3">
      <CardShell
        label={`Composition · ${report.compositionType}`}
        right={
          report.wallTimeMs != null && report.serialTimeMs != null ? (
            <span>
              wall {fmtDuration(report.wallTimeMs)} vs serial {fmtDuration(report.serialTimeMs)}
            </span>
          ) : report.finalAgentId ? (
            `final · ${report.finalAgentId}`
          ) : undefined
        }
      >
        {(report.agreement != null || report.quorum != null) && (
          <div className="flex items-center gap-3 px-3.5 py-3 font-mono text-[11.5px]">
            {report.agreement != null && (
              <Chip tone="ok" mono>
                {Math.round(report.agreement * 100)}% agree
              </Chip>
            )}
            {report.quorum != null && (
              <span style={{ color: 'var(--qw-fg-muted)' }}>quorum · {String(report.quorum)}</span>
            )}
          </div>
        )}
        {report.handoffPath && report.handoffPath.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-3">
            {report.handoffPath.map((a, i) => {
              // Revisited agents (a swarm bouncing back to a peer) read in crux.
              const revisited = report.handoffPath!.filter((x) => x === a).length > 1
              return (
                <Fragment key={`${a}-${i}`}>
                  {i > 0 && <span style={{ color: 'var(--qw-fg-faint)' }}>→</span>}
                  <span
                    className="rounded-[8px] px-2.5 py-1 font-mono text-[11.5px] font-semibold"
                    style={{
                      background: revisited ? 'var(--qw-crux-soft)' : 'var(--qw-bg-elev)',
                      boxShadow: `inset 0 0 0 1px ${revisited ? 'var(--qw-crux-line)' : 'var(--qw-border)'}`,
                      color: revisited ? 'var(--qw-crux)' : 'var(--qw-fg)',
                    }}
                  >
                    {a}
                  </span>
                </Fragment>
              )
            })}
            {report.finalAgentId && (
              <Chip tone="muted" mono>
                final · {report.finalAgentId}
              </Chip>
            )}
          </div>
        )}
      </CardShell>

      {report.votes && report.votes.length > 0 && (
        <CardShell label={`Votes · ${report.votes.length}`}>
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {report.votes.map((v, i) => (
              <div key={`${v.agent}-${i}`} className="px-3.5 py-2" style={{ background: 'var(--qw-bg-elev)' }}>
                <div className="flex items-center gap-2 font-mono text-[11.5px]">
                  <span style={{ color: 'var(--qw-fg)' }}>{v.agent}</span>
                  {v.answer && <span style={{ color: 'var(--qw-fg-muted)' }}>· {v.answer}</span>}
                  {v.confidence != null && (
                    <span className="ml-auto" style={{ color: 'var(--qw-fg-faint)' }}>
                      {Math.round(v.confidence * 100)}%
                    </span>
                  )}
                </div>
                {v.reasoning && (
                  <div className="mt-1 text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {v.reasoning}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {report.roster && report.roster.length > 0 && (
        <CardShell label={`Agents · ${report.roster.length}`}>
          <div className="grid gap-2.5 p-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))' }}>
            {report.roster.map((a) => {
              const revisited = a.turns != null && a.turns > 1
              return (
                <div
                  key={a.id}
                  className="rounded-[10px] px-3 py-2.5"
                  style={{
                    background: 'var(--qw-bg-elev)',
                    border: `1px solid ${revisited ? 'var(--qw-warn-soft)' : 'var(--qw-border)'}`,
                  }}
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <KindTag kind="agent" primitive="agent.run" size={9} />
                    <span className="truncate font-mono text-[12px] font-semibold">{a.id}</span>
                  </div>
                  {a.role && (
                    <div className="mb-1.5 truncate text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                      {a.role}
                    </div>
                  )}
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px]"
                    style={{ color: 'var(--qw-fg-muted)' }}
                  >
                    {a.turns != null && (
                      <span style={{ color: revisited ? 'var(--qw-warn)' : undefined }}>×{a.turns} turns</span>
                    )}
                    {a.tokens != null && <span>{fmtTokens(a.tokens)} tok</span>}
                    {a.durationMs != null && <span>{fmtDuration(a.durationMs)}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </CardShell>
      )}

      {report.branches && report.branches.length > 0 && (
        <CardShell label={`Branches · ${report.branches.length}`}>
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {report.branches.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 px-3.5 py-2 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg-elev)' }}
              >
                <Chip tone={b.status === 'success' ? 'ok' : b.status === 'error' ? 'danger' : 'muted'} dot>
                  {b.status}
                </Chip>
                <span style={{ color: 'var(--qw-fg)' }}>{b.agentId ?? b.id}</span>
                <span className="ml-auto" style={{ color: 'var(--qw-fg-muted)' }}>
                  {fmtDuration(b.durationMs)}
                  {b.tokens != null ? ` · ${fmtTokens(b.tokens)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </CardShell>
      )}

      {report.stages && report.stages.length > 0 && (
        <CardShell label={`Stages · ${report.stages.length}`}>
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {report.stages.map((s, i) => (
              <div
                key={`${s.name}-${i}`}
                className="flex items-center gap-2 px-3.5 py-2 font-mono text-[11.5px]"
                style={{ background: 'var(--qw-bg-elev)' }}
              >
                <span style={{ color: 'var(--qw-fg-faint)' }}>{i + 1}.</span>
                <span style={{ color: 'var(--qw-fg)' }}>{s.name}</span>
                {s.status && (
                  <Chip tone={s.status === 'success' ? 'ok' : s.status === 'error' ? 'danger' : 'muted'} mono>
                    {s.status}
                  </Chip>
                )}
              </div>
            ))}
          </div>
        </CardShell>
      )}
    </div>
  )
}

// ─── tiny helpers ───────────────────────────────────────────────────

// ─── Flow steps as nested containers (design `ArchFlow` + `GraphNesting`) ──
//
// Steps are the top-level thing (NOT wrapped in a card). Each step is a
// container; a step that ran a composite (swarm / pipeline / consensus / a
// sub-flow) nests that composite *inside* it — "box = composite (container)",
// with drill-in. Nesting recurses: a sub-flow renders its own steps.

function isSuspendedStep(s: ObservabilityRunDetailNode): boolean {
  return s.status === 'suspended' || s.primitive === 'flow.suspension'
}
function isReplayedStep(s: ObservabilityRunDetailNode): boolean {
  return Boolean(findAttribute(s, 'replayed', 'replayedFromPriorRun'))
}
function stepDotColor(s: ObservabilityRunDetailNode): string {
  if (isSuspendedStep(s)) return 'var(--qw-crux)'
  if (s.status === 'success') return 'var(--qw-ok)'
  if (s.status === 'error') return 'var(--qw-danger)'
  if (s.status === 'running') return 'var(--qw-crux)'
  return 'var(--qw-fg-faint)'
}
export function FlowCard({ node, onSelect }: { node: ObservabilityRunDetailNode; onSelect: (id: string) => void }) {
  const steps = node.children ?? []
  if (steps.length === 0) return <EmptyHint>No steps recorded for this flow yet.</EmptyHint>
  return <FlowSteps node={node} onSelect={onSelect} withHeader depth={0} />
}

function FlowSteps({
  node,
  onSelect,
  withHeader,
  depth,
}: {
  node: ObservabilityRunDetailNode
  onSelect: (id: string) => void
  withHeader?: boolean
  depth: number
}) {
  const steps = node.children ?? []
  if (steps.length === 0) return null
  const replayed = steps.filter(isReplayedStep).length
  const suspended = steps.filter(isSuspendedStep).length
  const isFlowRun = (node.primitive ?? '').startsWith('flow.run')
  return (
    <div className="flex flex-col gap-2.5">
      {withHeader && (
        <Eyebrow>
          {isFlowRun ? 'Steps' : 'Children'} · {steps.length}
          {replayed ? ` · ${replayed} replayed` : ''}
          {suspended ? ` · ${suspended} suspended` : ''}
        </Eyebrow>
      )}
      {steps.map((s, i) => (
        <NestedSpan key={s.id} node={s} index={isFlowRun ? i + 1 : undefined} depth={depth} onSelect={onSelect} />
      ))}
    </div>
  )
}

const MAX_NEST_DEPTH = 4

/** Short kind label for a node's KindTag. A flow.step is a **step**, a flow.run is
 *  a **flow** (the artboard mislabels both as "flow"). */
function nestKindLabel(p: string | undefined): string {
  const s = p ?? ''
  if (s.startsWith('flow.step') || s === 'flow.suspension') return 'step'
  if (s.startsWith('flow')) return 'flow'
  if (s.startsWith('composition')) return 'composition'
  if (s.startsWith('agent')) return 'agent'
  if (s.startsWith('generation')) return 'generation'
  if (s.startsWith('tool')) return 'tool'
  if (s.startsWith('retrieval') || s.startsWith('embedding')) return 'retrieval'
  if (s.startsWith('memory')) return 'memory'
  return s.split('.')[0] || 'span'
}

/** The action a step ran — its first generation/tool/composition/flow child. */
function stepRanChild(step: ObservabilityRunDetailNode): ObservabilityRunDetailNode | undefined {
  const kids = step.children ?? []
  return (
    kids.find((c) => {
      const p = c.primitive ?? ''
      return p.startsWith('generation') || p.startsWith('tool') || p.startsWith('composition') || p.startsWith('flow')
    }) ?? kids[0]
  )
}

/** Container summary line: "N steps" (flow.run) / "N agents · M hops" (composition). */
function nestSummary(node: ObservabilityRunDetailNode): string | null {
  const p = node.primitive ?? ''
  const kids = node.children ?? []
  if (p.startsWith('flow.run')) return kids.length ? `${kids.length} step${kids.length === 1 ? '' : 's'}` : null
  if (p.startsWith('composition')) {
    const report = findArtifact(node, 'composition.report')?.preview as CruxCompositionReportPreview | undefined
    const agents = report?.roster?.length ?? (kids.length || undefined)
    const hops = report?.handoffPath ? Math.max(0, report.handoffPath.length - 1) : undefined
    return (
      [agents != null ? `${agents} agents` : null, hops != null ? `${hops} hops` : null].filter(Boolean).join(' · ') ||
      null
    )
  }
  return null
}

/**
 * One node in the flow/step structure view, rendered as a **plain container box**
 * (design `v9-archetypes` `GraphNesting`): kind chip · label · status · summary,
 * with its children nested *inside* the box — recursively; any primitive can
 * contain any other. Expanded by default down to `MAX_NEST_DEPTH` levels and
 * collapsible per box (chevron); beyond the cap a "drill in →" navigates in.
 */
function NestedSpan({
  node,
  index,
  depth,
  onSelect,
}: {
  node: ObservabilityRunDetailNode
  index?: number
  depth: number
  onSelect: (id: string) => void
}) {
  const kids = node.children ?? []
  const hasKids = kids.length > 0
  const canNest = hasKids && depth < MAX_NEST_DEPTH
  const [open, setOpen] = useState(true)
  const suspended = isSuspendedStep(node)
  const isStep = (node.primitive ?? '').startsWith('flow.step') || node.kind === 'step'
  const ranChild = isStep ? stepRanChild(node) : undefined
  const summary = nestSummary(node)

  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: suspended ? 'var(--qw-crux-soft)' : 'var(--qw-bg-elev)',
        border: `1px solid ${suspended ? 'var(--qw-crux-line)' : 'var(--qw-border)'}`,
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {canNest ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
            className="flex size-4 shrink-0 items-center justify-center"
          >
            {open ? (
              <ChevronDown size={13} className="text-(--qw-fg-faint)" />
            ) : (
              <ChevronRight size={13} className="text-(--qw-fg-faint)" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {index != null && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {String(index).padStart(2, '0')}
          </span>
        )}
        <span className="size-[7px] shrink-0 rounded-full" style={{ background: stepDotColor(node) }} />
        <KindTag kind={nestKindLabel(node.primitive)} primitive={node.primitive} size={8.5} />
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="truncate text-left font-mono text-[12px] font-semibold hover:underline"
        >
          {node.display?.label ?? node.name ?? node.primitive}
        </button>
        <Chip tone={statusTone(node.status)} dot>
          {statusLabel(node.status)}
        </Chip>
        {isReplayedStep(node) && (
          <span className="font-mono text-[9.5px]" style={{ color: 'var(--qw-iris)' }}>
            ↺ replayed
          </span>
        )}
        <div className="flex-1" />
        {ranChild && (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[9.5px]"
            style={{ color: 'var(--qw-fg-muted)' }}
          >
            ran <KindTag kind={nestKindLabel(ranChild.primitive)} primitive={ranChild.primitive} size={8} />
            <span className="truncate" style={{ maxWidth: 130 }}>
              {ranChild.display?.label ?? ranChild.name ?? ''}
            </span>
          </span>
        )}
        {summary && (
          <span className="font-mono text-[9.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {summary}
          </span>
        )}
        {hasKids && depth >= MAX_NEST_DEPTH && (
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className="inline-flex items-center gap-1 font-mono text-[10px]"
            style={{ color: 'var(--qw-crux)' }}
          >
            drill in →
          </button>
        )}
      </div>
      {canNest && open && (
        <div
          className="flex flex-col gap-2 px-3 pb-3 pt-0.5"
          style={{ marginLeft: 10, borderLeft: '1px solid var(--qw-border)' }}
        >
          {kids.map((c, i) => (
            <NestedSpan
              key={c.id}
              node={c}
              index={(c.primitive ?? '').startsWith('flow.step') ? i + 1 : undefined}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function Empty() {
  return (
    <span className="text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
      —
    </span>
  )
}
