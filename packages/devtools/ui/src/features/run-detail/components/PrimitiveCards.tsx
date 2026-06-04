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

import { type ReactNode } from 'react'
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
} from '@crux/core/observability'
import type { ObservabilityRunDetailNode } from '@/types'
import { CardShell, EmptyHint, KeyValue } from './SpanDetailPanelAtoms'
import {
  KIND_ACCENT,
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
  const tone: ChipTone = verdict === 'accepted' ? 'ok' : verdict === 'rejected' || verdict === 'error' ? 'warn' : 'muted'
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
            <div className="h-[18px] rounded-[4px]" style={{ width: `${afterW}%`, background: 'var(--qw-ok)', opacity: 0.8 }} />
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
            style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)', color: 'var(--qw-fg-muted)' }}
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
                      <div className="mt-1.5 rounded-[7px] px-3 py-2 text-[11.5px]" style={{ background: 'var(--qw-warn-soft)', color: 'var(--qw-fg)' }}>
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
              <div className="text-[12.5px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}>
                {report.preview}
              </div>
            )}
          </div>
        </Section>
      )}
    </div>
  )
}

function SourceTotals({ totals }: { totals: Record<string, number | undefined> }) {
  const entries = Object.entries(totals).filter(([, v]) => typeof v === 'number')
  return (
    <div className="grid gap-px" style={{ background: 'var(--qw-border)', gridTemplateColumns: 'repeat(4, 1fr)' }}>
      {entries.map(([k, v]) => (
        <Tile key={k} label={k} value={String(v)} />
      ))}
    </div>
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
        {sources.slice(0, 40).map((s) => (
          <div
            key={s.id}
            className="grid items-center gap-2 px-3.5 py-1.5 font-mono text-[11px]"
            style={{ background: 'var(--qw-bg-elev)', gridTemplateColumns: '1fr 90px 60px' }}
          >
            <span className="truncate" style={{ color: 'var(--qw-fg)' }} title={s.reason}>
              {s.id}
            </span>
            <Chip tone="muted" mono>
              {s.action}
            </Chip>
            <span className="text-right" style={{ color: 'var(--qw-fg-muted)' }}>
              {s.chunks != null ? `${s.chunks} ch` : ''}
            </span>
          </div>
        ))}
      </div>
    </CardShell>
  )
}

function CorpusReport({ report }: { report: CruxCorpusReportPreview }) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Corpus sync{report.mode ? ` · ${report.mode}` : ''}</Eyebrow>
      <SourceTotals totals={report.totals} />
      <SourceRows sources={report.sources} />
    </div>
  )
}

function IndexingReport({ report }: { report: CruxIndexingReportPreview }) {
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Indexing · {report.operation}</Eyebrow>
      <SourceTotals totals={report.totals} />
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

export function AgentCard({ node, onSelect }: { node: ObservabilityRunDetailNode; onSelect: (id: string) => void }) {
  const instructions = findAttribute(node, 'instructions', 'systemPrompt', 'system')
  const instructionsText = typeof instructions === 'string' ? instructions : undefined

  const children = node.children ?? []
  const used = new Set(
    gatherDescendants(node)
      .map((n) => n.toolName)
      .filter((t): t is string => !!t),
  )
  const availableRaw = findAttribute(node, 'toolsAvailable', 'tools')
  const available = Array.isArray(availableRaw) ? availableRaw.filter((t): t is string => typeof t === 'string') : []
  // Union: declared available tools + any used tool not in the declared list.
  const toolNames = Array.from(new Set([...available, ...used]))

  return (
    <div className="flex flex-col gap-3">
      {instructionsText && (
        <CardShell label="Instructions">
          <div
            className="whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-[1.55]"
            style={{ fontFamily: 'var(--qw-serif)' }}
          >
            {instructionsText.length > 1200 ? instructionsText.slice(0, 1200) + '…' : instructionsText}
          </div>
        </CardShell>
      )}

      {toolNames.length > 0 && (
        <CardShell label={`Tools available · ${toolNames.length}`} right={`${used.size} used`}>
          <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
            {toolNames.map((t) => {
              const isUsed = used.has(t)
              return (
                <span
                  key={t}
                  className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px]"
                  style={{
                    background: 'var(--qw-bg-muted)',
                    color: isUsed ? 'var(--qw-fg)' : 'var(--qw-fg-faint)',
                    border: `1px ${isUsed ? 'solid' : 'dashed'} var(--qw-border)`,
                  }}
                  title={isUsed ? `${t} · used` : `${t} · available (not used)`}
                >
                  {isUsed && <span className="size-1.5 rounded-full" style={{ background: 'var(--qw-ok)' }} />}
                  {t}
                </span>
              )
            })}
          </div>
        </CardShell>
      )}

      <CardShell label={`React loop · ${children.length}`}>
        {children.length === 0 ? (
          <div className="px-3.5 py-3 text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
            (no steps recorded)
          </div>
        ) : (
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {children.map((c, i) => {
              const accent = KIND_ACCENT[classifyPrimitive(c.primitive)]
              return (
                <button
                  key={c.id}
                  onClick={() => onSelect(c.id)}
                  className="grid items-center gap-2.5 px-3.5 py-2 text-left transition-opacity hover:opacity-90"
                  style={{
                    background: 'var(--qw-bg-elev)',
                    gridTemplateColumns: '24px 88px 1fr 70px',
                    borderLeft: `2px solid ${accent}`,
                  }}
                >
                  <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <Chip tone={statusTone(c.status)} dot>
                    {statusLabel(c.status)}
                  </Chip>
                  <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[11.5px]">
                    <span style={{ color: accent }}>{c.primitive}</span>
                    <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }}>
                      {c.display?.label ?? c.name}
                    </span>
                  </span>
                  <span className="text-right font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                    {fmtDuration(nodeDuration(c))}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </CardShell>
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
          <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-3 font-mono text-[11.5px]">
            {report.handoffPath.map((a, i) => (
              <span key={`${a}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span style={{ color: 'var(--qw-fg-faint)' }}>→</span>}
                <span style={{ color: a === report.finalAgentId ? 'var(--qw-crux)' : 'var(--qw-fg)' }}>{a}</span>
              </span>
            ))}
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
          <div className="flex flex-col gap-px" style={{ background: 'var(--qw-border)' }}>
            {report.roster.map((a) => (
              <div
                key={a.id}
                className="grid items-center gap-2 px-3.5 py-1.5 font-mono text-[11px]"
                style={{ background: 'var(--qw-bg-elev)', gridTemplateColumns: '1fr 110px 50px 70px 70px' }}
              >
                <span className="truncate" style={{ color: 'var(--qw-fg)' }}>
                  {a.id}
                </span>
                <span className="truncate" style={{ color: 'var(--qw-fg-muted)' }}>
                  {a.role ?? ''}
                </span>
                <span style={{ color: a.turns && a.turns > 1 ? 'var(--qw-warn)' : 'var(--qw-fg-muted)' }}>
                  {a.turns != null ? `×${a.turns}` : ''}
                </span>
                <span className="text-right" style={{ color: 'var(--qw-fg-muted)' }}>
                  {fmtDuration(a.durationMs)}
                </span>
                <span className="text-right" style={{ color: 'var(--qw-fg-muted)' }}>
                  {fmtTokens(a.tokens)}
                </span>
              </div>
            ))}
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

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-2.5" style={{ background: 'var(--qw-bg-elev)' }}>
      <div className="text-[9.5px] uppercase tracking-[0.04em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {label}
      </div>
      <div className="font-mono text-[14px] font-semibold">{value}</div>
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
