/**
 * Cell evidence — the failing cell, opened as a first-class debug surface.
 *
 * Bound to the backend-owned `QualityCellEvidence` read model: the server
 * performs the joins (authored source frame · evaluated values · trial context
 * · baseline · trace) and we render what it provides. The surface NEVER
 * fabricates a value — when a field is absent (old record, redacted, stale
 * source, no baseline output, no trace) the backend hands us an explicit
 * degradation and we show it honestly.
 *
 * Structure (per the Quality Workbench handover):
 *   SPINE (always)  identity · failure summary · trial spread · I/O ·
 *                   scorer-vs-floor bars (+ inline judge rationale)
 *   WHY lens        authored source frame, evaluated comparison,
 *                   "values at this check", all assertions
 *   BASELINE lens   passing baseline output beside the candidate + score moves
 *   TRACE lens      span waterfall + hot span + root-cause hint
 * The default lens follows the failure (errored → Trace, else Why).
 */

import * as React from 'react'
import { Btn, Chip } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import { CellStatusChip, ScorerChip, fmtCost, fmtLatency, shortId } from '@/qw/shell/qualityKit'
import { useQualityCellEvidence, useQualityFeedback } from '@/shared/hooks/useQualityApi'
import { useLabelCellMutation } from '@/shared/hooks/useQualityMutations'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useToast } from '@/qw/shell/useToast'
import { ValueView } from '@/shared/components/ValueView'
import { SourceFrame } from './SourceFrameView'
import { FailureArtifactPanel } from './FailureArtifactPanel'
import type {
  QualityCellEvidence,
  QualityFailureArtifact,
  QualityJsonValue,
  QualityScoreEvidence,
  QualityAssertionValue,
} from '@/types'
import { assertionMessage, assertionStatement, decisiveCheck, evaluatedStatement } from '../lib/cell-evidence-format'
import { latestCellLabel } from '../lib/cell-labels'

type Lens = 'why' | 'baseline' | 'trace'

// ─── helpers ─────────────────────────────────────────────────────────

function jsonText(v: QualityJsonValue | undefined): string {
  if (v == null) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

function num(v: QualityJsonValue): string {
  if (typeof v === 'number') return v.toFixed(2).replace(/\.00$/, '')
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  return jsonText(v)
}

interface FailureMeta {
  label: string
  title: string
}

function failureMeta(ev: QualityCellEvidence): FailureMeta | null {
  const status = ev.cell.status
  if (status === 'passed' || status === 'skipped') return null
  if (status === 'errored') {
    return { label: 'runtime error', title: ev.cell.error?.message ?? 'the task crashed before producing output' }
  }
  const c = decisiveCheck(ev)
  if (c?.kind === 'assertion') return { label: 'assertion failed', title: c.summary }
  if (c?.kind === 'score-threshold')
    return { label: 'score gate failed', title: `${c.scoreName} ${c.score.toFixed(2)} ${c.operator} ${c.threshold}` }
  if (c?.kind === 'runtime-error') return { label: 'runtime error', title: c.message }
  return { label: 'failed', title: 'a check failed' }
}

/** Absolute authored path → compact `file:line` (drops dir prefix and column). */
function shortRef(ref: string): string {
  const m = ref.match(/([^/\\:]+):(\d+)(?::\d+)?$/)
  return m ? `${m[1]}:${m[2]}` : ref
}

// ─── value rows ──────────────────────────────────────────────────────

function ValueCell({ entry }: { entry: QualityAssertionValue }) {
  if (entry.redacted)
    return (
      <span className="font-mono text-[11.5px] italic" style={{ color: 'var(--qw-fg-faint)' }}>
        ⋯ redacted
      </span>
    )
  return (
    <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg)' }}>
      {entry.preview || num(entry.value)}
    </span>
  )
}

function Field({
  label,
  tone,
  mono,
  children,
}: {
  label: string
  tone?: 'danger'
  mono?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {label}
      </div>
      <div
        className="rounded-[8px] px-3 py-2.5 leading-[1.6]"
        style={{
          background: 'var(--qw-bg)',
          boxShadow: `inset 0 0 0 1px ${tone ? 'var(--qw-danger-line)' : 'var(--qw-border)'}`,
          fontFamily: mono ? undefined : 'var(--qw-serif)',
          fontSize: mono ? 12 : 13,
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ─── scorer bar with inline judge rationale ─────────────────────────

function ScoreBar({ s }: { s: QualityScoreEvidence }) {
  const [open, setOpen] = React.useState(false)
  const hasRationale = Boolean(s.rationale)
  const thr = s.threshold
  const bad = thr?.passed === false
  return (
    <div>
      <div
        onClick={hasRationale ? () => setOpen(!open) : undefined}
        className="grid items-center gap-3 py-[7px]"
        style={{ gridTemplateColumns: '168px 1fr 52px 16px', cursor: hasRationale ? 'pointer' : 'default' }}
      >
        <ScorerChip name={s.name} costClass={s.costClass} />
        <div className="relative h-[22px]">
          <div
            className="absolute inset-x-0 rounded-full"
            style={{ top: 9, bottom: 9, background: 'var(--qw-bg-muted)' }}
          />
          <div
            className="absolute rounded-full"
            style={{
              top: 9,
              bottom: 9,
              left: 0,
              width: `${Math.max(0, Math.min(1, s.score)) * 100}%`,
              background: bad ? 'var(--qw-danger)' : 'var(--qw-ok)',
              opacity: 0.85,
            }}
          />
          {thr && (
            <div
              title={`floor ${thr.value}`}
              className="absolute"
              style={{
                top: 1,
                bottom: 1,
                left: `${Math.max(0, Math.min(1, thr.value)) * 100}%`,
                width: 2,
                background: 'var(--qw-fg)',
              }}
            />
          )}
        </div>
        <span
          className="text-right font-mono text-[12px] font-semibold"
          style={{ color: bad ? 'var(--qw-danger)' : 'var(--qw-ok)' }}
        >
          {s.score.toFixed(2)}
        </span>
        {hasRationale ? (
          <Icon
            name="arrowRight"
            size={12}
            color="var(--qw-fg-faint)"
            className={open ? 'rotate-90 transition-transform' : 'transition-transform'}
          />
        ) : (
          <span />
        )}
      </div>
      {hasRationale && open && (
        <div
          className="mb-2 mt-0.5 rounded-[8px] px-3 py-2.5"
          style={{ background: 'var(--qw-gold-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-gold-line)' }}
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <Icon name="sparkle" size={12} color="var(--qw-gold)" />
            <span
              className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em]"
              style={{ color: 'var(--qw-gold)' }}
            >
              judge rationale
            </span>
          </div>
          <p className="m-0 text-[12.5px] leading-[1.55]" style={{ fontFamily: 'var(--qw-serif)' }}>
            “{s.rationale}”
          </p>
        </div>
      )}
    </div>
  )
}

// ─── the surface ─────────────────────────────────────────────────────

export function CellEvidenceView({
  experimentId,
  caseId,
  variantName,
  trial,
  status,
  skipReason,
  failure,
  onOpenTrace,
}: {
  experimentId: string
  caseId: string
  variantName: string
  trial: number
  status: 'passed' | 'failed' | 'errored' | 'skipped'
  skipReason?: string
  /** Core-owned failure artifact for this cell, when the parent record has one. */
  failure?: QualityFailureArtifact
  onOpenTrace: (traceId: string) => void
}) {
  // Skipped cells produced no evidence — show the reason inline, never fetch.
  if (status === 'skipped') {
    return (
      <div className="px-4 py-3 font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
        skipped — {skipReason ?? 'no reason given'}
      </div>
    )
  }
  return (
    <CellEvidenceBody
      experimentId={experimentId}
      caseId={caseId}
      variantName={variantName}
      trial={trial}
      failure={failure}
      onOpenTrace={onOpenTrace}
    />
  )
}

function CellEvidenceBody({
  experimentId,
  caseId,
  variantName,
  trial,
  failure,
  onOpenTrace,
}: {
  experimentId: string
  caseId: string
  variantName: string
  trial: number
  failure?: QualityFailureArtifact
  onOpenTrace: (traceId: string) => void
}) {
  const cellKey = React.useMemo(() => ({ caseId, variantName, trial }), [caseId, variantName, trial])
  const { data: ev, loading, error } = useQualityCellEvidence(experimentId, cellKey)
  const { data: feedback = [] } = useQualityFeedback()
  const labelCell = useLabelCellMutation()
  const { navigate } = useNavigation()
  const { toast } = useToast()
  const [note, setNote] = React.useState('')
  const [noteOpen, setNoteOpen] = React.useState(false)
  const existingLabel = latestCellLabel(feedback, { experimentId, caseId, variant: variantName, trial })
  const onLabel = (verdict: 'pass' | 'fail') => {
    void labelCell({ experimentId, caseId, variant: variantName, trial, verdict, note: note.trim() || undefined })
    setNote('')
    setNoteOpen(false)
  }

  const recommended: Lens = ev?.cell.status === 'errored' ? 'trace' : 'why'
  const [lens, setLens] = React.useState<Lens>(recommended)
  React.useEffect(() => {
    setLens(ev?.cell.status === 'errored' ? 'trace' : 'why')
  }, [ev?.cell.status, caseId, variantName])

  if (loading && !ev) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 font-mono text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
        <span
          className="size-2.5 rounded-full"
          style={{ background: 'var(--qw-crux)', animation: 'cat-pulse 1.4s ease-in-out infinite' }}
        />
        loading evidence…
      </div>
    )
  }
  if (error || !ev) {
    return (
      <div className="px-4 py-3.5 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
        Couldn’t load cell evidence{error ? ` — ${error.message}` : ''}.
      </div>
    )
  }

  const { cell, trialSummary: ts, io } = ev
  const isErr = cell.status === 'errored'
  const isPass = cell.status === 'passed'
  const fm = failureMeta(ev)
  const tokens = cell.usage ? cell.usage.inputTokens + cell.usage.outputTokens : null
  const evaluated = evaluatedStatement(ev)
  const heldCount = ev.assertions.outcomes.filter((a) => a.status === 'passed').length

  const lensDefs: { key: Lens; label: string; icon: IconName }[] = [
    { key: 'why', label: isErr ? 'Why · error' : 'Why · assertion', icon: 'doc' },
    { key: 'baseline', label: 'vs Baseline', icon: 'diff' },
    { key: 'trace', label: 'Trace', icon: 'trace' },
  ]

  const copyRepro = () => {
    const cmd = [ev.repro.command, ...ev.repro.args].join(' ')
    void navigator.clipboard?.writeText(cmd)
    toast({ kind: 'ok', title: 'Repro command copied', message: cmd })
  }

  return (
    <div style={{ background: 'var(--qw-bg-elev)', borderTop: '1px solid var(--qw-border)' }}>
      {/* HEADER */}
      <div
        className="flex flex-col gap-2.5 px-[18px] py-3"
        style={{
          borderBottom: '1px solid var(--qw-border)',
          background: isPass
            ? 'var(--qw-ok-soft)'
            : isErr
              ? 'repeating-linear-gradient(135deg, var(--qw-danger-soft), var(--qw-danger-soft) 6px, transparent 6px, transparent 12px)'
              : 'var(--qw-danger-soft)',
        }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <CellStatusChip status={cell.status} />
          <Chip tone="crux" mono>
            {variantName}
          </Chip>
          {fm && (
            <Chip tone="danger" dot>
              {fm.label}
            </Chip>
          )}
          {/* LABEL — human verdict on this cell (blueprint §12.4) */}
          <div className="ml-auto flex items-center gap-2">
            {existingLabel && (
              <Chip tone={existingLabel.verdict === 'pass' ? 'ok' : 'danger'} title={`labeled ${existingLabel.at}`}>
                labeled {existingLabel.verdict} · {existingLabel.at.slice(0, 10)}
              </Chip>
            )}
            <Btn
              size="xs"
              variant="soft"
              icon={<Icon name="check" size={11} />}
              onClick={() => onLabel('pass')}
            >
              Pass
            </Btn>
            <Btn size="xs" variant="soft" icon={<Icon name="x" size={11} />} onClick={() => onLabel('fail')}>
              Fail
            </Btn>
            <Btn
              size="xs"
              variant="ghost"
              title="add a note to your next label"
              onClick={() => setNoteOpen((v) => !v)}
            >
              note
            </Btn>
          </div>
        </div>
        {noteOpen && (
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="optional note — applied to your next Pass/Fail label"
            className="rounded-[7px] px-2.5 py-1.5 text-[12px]"
            style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)', color: 'var(--qw-fg)' }}
          />
        )}
        <div
          className="flex flex-wrap items-center gap-4 font-mono text-[11px]"
          style={{ color: 'var(--qw-fg-muted)' }}
        >
          <span>{fmtLatency(cell.durationMs)}</span>
          {cell.costUsd != null && <span>{fmtCost(cell.costUsd)}</span>}
          {tokens != null && <span>{tokens.toLocaleString()} tok</span>}
          {/* trial spread — cell-level ±SEM */}
          {ts.total > 1 && (
            <div className="ml-auto flex items-center gap-1.5">
              <span>{ts.total} trials</span>
              {ts.trials.map((tr) => (
                <span
                  key={tr.trial}
                  title={`trial ${tr.trial + 1} · ${tr.status}`}
                  className="size-3.5 rounded-[4px]"
                  style={{
                    background: tr.status === 'passed' ? 'var(--qw-ok-soft)' : 'var(--qw-danger-soft)',
                    boxShadow: `inset 0 0 0 1px ${tr.status === 'passed' ? 'var(--qw-ok)' : 'var(--qw-danger)'}`,
                  }}
                />
              ))}
              {ts.verdict === 'flaky' && (
                <Chip tone="warn">
                  flaky · {ts.passed}/{ts.total}
                </Chip>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SPINE */}
      <div className="flex flex-col gap-4 px-[18px] py-4">
        {fm && (
          <div
            className="rounded-[10px] px-3.5 py-2.5"
            style={{ background: 'var(--qw-danger-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-danger-line)' }}
          >
            <div className="flex items-center gap-1.5">
              <Icon name={isErr ? 'alert' : 'x'} size={14} color="var(--qw-danger)" strokeWidth={2.4} />
              <span className="text-[13px] font-semibold">{fm.title}</span>
              {!isErr && ev.assertions.ran > 0 && (
                <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {ev.assertions.outcomes.filter((a) => a.status === 'failed').length} of {ev.assertions.ran} assertions
                  failed
                </span>
              )}
              {isErr && cell.error && (
                <span className="ml-auto font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  phase · {cell.error.phase}
                </span>
              )}
            </div>
          </div>
        )}
        {isPass && (
          <div
            className="flex items-center gap-1.5 rounded-[10px] px-3.5 py-2.5"
            style={{ background: 'var(--qw-ok-soft)', boxShadow: 'inset 0 0 0 1px var(--qw-ok-line)' }}
          >
            <Icon name="check" size={14} color="var(--qw-ok)" strokeWidth={2.4} />
            <span className="text-[13px] font-semibold">All assertions held</span>
          </div>
        )}

        {io.input != null && <ValueView label="input" value={io.input} />}
        {io.output != null && (
          <div>
            <ValueView
              label={`output · ${variantName}`}
              tone={cell.status === 'failed' ? 'danger' : undefined}
              value={io.output}
            />
            {io.outputTruncated && (
              <span className="mt-1 inline-block font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
                …truncated
              </span>
            )}
          </div>
        )}
        {isErr && io.output == null && cell.error && (
          <Field label="output" tone="danger" mono>
            <span style={{ color: 'var(--qw-danger)' }}>{cell.error.message}</span>{' '}
            <span style={{ color: 'var(--qw-fg-faint)' }}>— no output produced (task crashed)</span>
          </Field>
        )}
        {io.expected != null && <ValueView label="expected" value={io.expected} />}

        {ev.scores.length > 0 && (
          <div>
            <div
              className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              Scorers · value vs floor
            </div>
            {ev.scores.map((s) => (
              <ScoreBar key={s.name} s={s} />
            ))}
            <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              vertical mark = gate floor · click a model judge for its rationale
            </div>
          </div>
        )}
      </div>

      {/* LENSES */}
      <div
        className="flex gap-0.5 px-3 py-2"
        style={{
          borderTop: '1px solid var(--qw-border)',
          borderBottom: '1px solid var(--qw-border)',
          background: 'var(--qw-bg)',
        }}
      >
        {lensDefs.map((ld) => {
          const on = lens === ld.key
          return (
            <button
              key={ld.key}
              onClick={() => setLens(ld.key)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 py-1.5 text-[12px] font-semibold"
              style={{
                background: on ? 'var(--qw-bg-muted)' : 'transparent',
                color: on ? 'var(--qw-fg)' : 'var(--qw-fg-muted)',
                boxShadow: on ? 'inset 0 0 0 1px var(--qw-border)' : 'none',
              }}
            >
              <Icon
                name={ld.icon}
                size={13}
                color={on ? (ld.key === 'why' ? 'var(--qw-crux)' : 'var(--qw-fg)') : 'var(--qw-fg-faint)'}
              />
              {ld.label}
              {ld.key === recommended && (
                <span className="size-[5px] rounded-full" style={{ background: 'var(--qw-crux)' }} />
              )}
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-4 p-[18px]">
        {lens === 'why' && (
          <>
            {failure && (
              <FailureArtifactPanel
                failure={failure}
                onNavigate={(promptId) => navigate({ view: 'library-index', promptId })}
              />
            )}
            <WhyLens ev={ev} evaluated={evaluated} isErr={isErr} heldCount={heldCount} />
          </>
        )}
        {lens === 'baseline' && <BaselineLens ev={ev} />}
        {lens === 'trace' && <TraceLens ev={ev} onOpenTrace={onOpenTrace} />}
      </div>

      {/* ADAPT */}
      <div
        className="flex flex-wrap items-center gap-2 px-[18px] py-3"
        style={{ borderTop: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
      >
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
          Adapt →
        </span>
        <Btn size="sm" icon={<Icon name="doc" size={12} />} onClick={copyRepro}>
          Copy repro
        </Btn>
        <span
          className="ml-auto max-w-[420px] truncate font-mono text-[10.5px]"
          style={{ color: 'var(--qw-fg-faint)' }}
        >
          {[ev.repro.command, ...ev.repro.args].join(' ')}
        </span>
      </div>
    </div>
  )
}

// ─── WHY ─────────────────────────────────────────────────────────────

function WhyLens({
  ev,
  evaluated,
  isErr,
  heldCount,
}: {
  ev: QualityCellEvidence
  evaluated: { rendered: string; passed: boolean } | null
  isErr: boolean
  heldCount: number
}) {
  const frame = ev.code.primaryFrame
  const fileLabel =
    frame.kind === 'source-frame'
      ? shortRef(`${frame.authoredFile}:${frame.authoredLine}`)
      : (ev.checks.find((c) => c.kind === 'assertion')?.outcomeId ?? 'source')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Icon name="doc" size={13} color="var(--qw-fg-muted)" />
          <span className="font-mono text-[11.5px]">{fileLabel}</span>
          {ev.code.openedInEditor && (
            <span
              title={`${ev.code.openedInEditor.file}:${ev.code.openedInEditor.line}`}
              className="font-mono text-[11px]"
              style={{ color: 'var(--qw-fg-faint)' }}
            >
              · {shortRef(`${ev.code.openedInEditor.file}:${ev.code.openedInEditor.line}`)}
            </span>
          )}
        </div>
        <SourceFrame frame={frame} />
      </div>
      {isErr && ev.cell.error && (
        <div
          className="rounded-[10px] px-4 py-3.5"
          style={{
            background:
              'repeating-linear-gradient(135deg, var(--qw-danger-soft), var(--qw-danger-soft) 6px, transparent 6px, transparent 12px)',
            boxShadow: 'inset 0 0 0 1px var(--qw-danger-line)',
          }}
        >
          <div className="mb-1.5 flex items-center gap-2">
            <Icon name="alert" size={15} color="var(--qw-danger)" />
            <span className="text-[13px] font-semibold" style={{ color: 'var(--qw-danger)' }}>
              Harness errored · phase {ev.cell.error.phase}
            </span>
          </div>
          <div className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {ev.cell.error.message}
            {ev.cell.error.missingCassetteKey ? ` · missing cassette key ${ev.cell.error.missingCassetteKey}` : ''}
          </div>
          <div className="mt-2 text-[11.5px] leading-[1.5]" style={{ color: 'var(--qw-fg-faint)' }}>
            {frame.kind === 'source-frame'
              ? 'No assertions ran; the source frame above points to the callback crash site.'
              : 'No assertions ran, and this record did not capture a source location for the crash.'}{' '}
            The <b>Trace</b> lens shows runtime spans when available.
          </div>
        </div>
      )}

      {evaluated && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-[10px] px-4 py-3 font-mono text-[13px]"
          style={{
            background: evaluated.passed ? 'var(--qw-ok-soft)' : 'var(--qw-danger-soft)',
            boxShadow: `inset 0 0 0 1px ${evaluated.passed ? 'var(--qw-ok-line)' : 'var(--qw-danger-line)'}`,
          }}
        >
          <span>{evaluated.rendered}</span>
        </div>
      )}

      {ev.code.valuesAtCheck.length > 0 && (
        <div>
          <div
            className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            Values at this check
          </div>
          <div
            className="overflow-hidden rounded-[10px]"
            style={{ background: 'var(--qw-bg)', border: '1px solid var(--qw-border)' }}
          >
            {ev.code.valuesAtCheck.map((entry, i) => (
              <div
                key={`${entry.label}-${i}`}
                className="grid items-baseline gap-3 px-3.5 py-2"
                style={{
                  gridTemplateColumns: '180px 1fr',
                  borderBottom: i === ev.code.valuesAtCheck.length - 1 ? 'none' : '1px solid var(--qw-border)',
                }}
              >
                <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-iris)' }}>
                  {entry.label}
                </span>
                <ValueCell entry={entry} />
              </div>
            ))}
          </div>
        </div>
      )}

      {ev.assertions.outcomes.length > 0 && (
        <div>
          <div
            className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em]"
            style={{ color: 'var(--qw-fg-faint)' }}
          >
            All assertions · {heldCount}/{ev.assertions.outcomes.length} held
          </div>
          <div className="flex flex-col gap-1.5">
            {ev.assertions.outcomes.map((a) => {
              const failed = a.status === 'failed'
              const notRun = a.status === 'not-evaluated' || a.status === 'uncaptured'
              const message = assertionMessage(ev.checks, a)
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-2.5 rounded-[8px] px-3 py-2"
                  style={{
                    background: failed ? 'var(--qw-danger-soft)' : 'transparent',
                    boxShadow: `inset 0 0 0 1px ${failed ? 'var(--qw-danger-line)' : 'var(--qw-border)'}`,
                  }}
                >
                  <Icon
                    name={failed ? 'x' : notRun ? 'more' : 'check'}
                    size={12}
                    color={failed ? 'var(--qw-danger)' : notRun ? 'var(--qw-fg-faint)' : 'var(--qw-ok)'}
                    strokeWidth={2.4}
                    className="mt-0.5"
                  />
                  <div className="min-w-0">
                    <div
                      className="font-mono text-[11.5px]"
                      style={{ color: failed ? 'var(--qw-fg)' : 'var(--qw-fg-muted)' }}
                    >
                      {assertionStatement(a)}
                      {notRun && (
                        <span className="ml-1.5" style={{ color: 'var(--qw-fg-faint)' }}>
                          · not evaluated
                        </span>
                      )}
                    </div>
                    {message && failed && (
                      <div
                        className="mt-[3px] text-[11.5px]"
                        style={{ color: 'var(--qw-danger)', fontFamily: 'var(--qw-serif)' }}
                      >
                        {message}
                      </div>
                    )}
                    {a.sourceRef && (
                      <span
                        title={a.sourceRef}
                        className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px]"
                        style={{ color: failed ? 'var(--qw-crux)' : 'var(--qw-fg-faint)' }}
                      >
                        <Icon name="link" size={11} color={failed ? 'var(--qw-crux)' : 'var(--qw-fg-faint)'} />{' '}
                        {shortRef(a.sourceRef)}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BASELINE ────────────────────────────────────────────────────────

const BASELINE_UNAVAILABLE: Record<string, { title: string; body: string }> = {
  'no-baseline': {
    title: 'No baseline output stored',
    body: 'This run wasn’t compared against a promoted baseline. Promote a good run to enable the diff.',
  },
  'baseline-has-no-output-evidence': {
    title: 'Baseline predates output storage',
    body: 'A baseline exists but was promoted before per-case output was retained, so there’s nothing to diff against.',
  },
  'baseline-experiment-missing': {
    title: 'Baseline experiment is gone',
    body: 'The promoted baseline’s experiment record is no longer on disk.',
  },
  'case-not-in-baseline': {
    title: 'Case not in the baseline',
    body: 'This case didn’t exist when the baseline was promoted, so there’s no matching cell to compare.',
  },
  'variant-not-comparable': {
    title: 'Variant not comparable',
    body: 'The baseline variant and this candidate aren’t directly comparable for this case.',
  },
}

function BaselineLens({ ev }: { ev: QualityCellEvidence }) {
  if (ev.baseline.kind === 'unavailable') {
    const meta = BASELINE_UNAVAILABLE[ev.baseline.reason] ?? {
      title: 'No baseline comparison',
      body: 'No baseline evidence is available for this cell.',
    }
    return (
      <div className="rounded-[10px] px-5 py-5 text-center" style={{ border: '1px dashed var(--qw-border)' }}>
        <Icon name="bookmark" size={18} color="var(--qw-fg-faint)" />
        <div className="mt-2 text-[13px] font-semibold">{meta.title}</div>
        <div className="mx-auto mt-1 max-w-[340px] text-[12px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
          {meta.body}
        </div>
      </div>
    )
  }
  const b = ev.baseline
  return (
    <div className="flex flex-col gap-3.5">
      <div
        className="flex flex-wrap items-center gap-2 font-mono text-[11.5px]"
        style={{ color: 'var(--qw-fg-muted)' }}
      >
        <Chip tone="muted" mono>
          baseline
        </Chip>
        <Icon name="arrowRight" size={13} color="var(--qw-fg-faint)" />
        <Chip tone="crux" mono>
          {ev.cell.variantName}
        </Chip>
        {b.experimentId && (
          <span className="ml-auto">
            {b.sameInput ? 'same input · ' : ''}
            {shortId(b.experimentId)}
          </span>
        )}
      </div>
      <div
        className="rounded-[10px] px-3.5 py-3"
        style={{
          background: 'var(--qw-bg)',
          boxShadow: `inset 0 0 0 1px ${b.baselineCell.status === 'passed' ? 'var(--qw-ok-line)' : 'var(--qw-danger-line)'}`,
        }}
      >
        <div
          className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
          style={{ color: b.baselineCell.status === 'passed' ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
        >
          baseline · {b.baselineCell.status}
        </div>
        <ValueView bare value={b.baselineCell.output} />
      </div>
      <div
        className="rounded-[10px] px-3.5 py-3"
        style={{
          background: 'var(--qw-bg)',
          boxShadow: `inset 0 0 0 1px ${ev.cell.status === 'passed' ? 'var(--qw-ok-line)' : 'var(--qw-danger-line)'}`,
        }}
      >
        <div
          className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em]"
          style={{ color: ev.cell.status === 'passed' ? 'var(--qw-ok)' : 'var(--qw-danger)' }}
        >
          {ev.cell.variantName} · {ev.cell.status}
        </div>
        <ValueView bare value={ev.io.output != null ? ev.io.output : (ev.cell.error?.message ?? '—')} />
      </div>
      {b.deltas.length > 0 && (
        <div className="flex flex-wrap gap-5 rounded-[10px] px-3.5 py-2.5" style={{ background: 'var(--qw-bg-muted)' }}>
          {b.deltas.map((d) => {
            const worse = d.delta < 0
            return (
              <span key={d.scoreName} className="font-mono text-[11.5px]">
                {d.scoreName}{' '}
                <b style={{ color: worse ? 'var(--qw-danger)' : 'var(--qw-fg-muted)' }}>
                  {d.baseline.toFixed(2)} → {d.candidate.toFixed(2)}
                </b>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── TRACE ───────────────────────────────────────────────────────────

function TraceLens({ ev, onOpenTrace }: { ev: QualityCellEvidence; onOpenTrace: (traceId: string) => void }) {
  const trace = ev.trace
  if (!trace.traceIds.length) {
    return (
      <div className="rounded-[10px] px-5 py-5 text-center" style={{ border: '1px dashed var(--qw-border)' }}>
        <Icon name="trace" size={18} color="var(--qw-fg-faint)" />
        <div className="mt-2 text-[13px] font-semibold">No trace linked</div>
        <div className="mx-auto mt-1 max-w-[340px] text-[12px] leading-[1.5]" style={{ color: 'var(--qw-fg-muted)' }}>
          This cell didn’t emit a trace, or trace retention has expired for this run.
        </div>
      </div>
    )
  }
  const span = trace.spans
  const retainedTraceIds = trace.retainedTraceIds ?? []
  const retainedTraceId = retainedTraceIds[0]
  const total = span.length ? Math.max(...span.map((s) => s.startMs + s.durationMs)) || 1 : 1
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
        Span waterfall · where it diverged
      </div>
      {span.length ? (
        span.map((sp, i) => {
          const bad = sp.status === 'error' || sp.hot
          const left = (sp.startMs / total) * 100
          const width = (sp.durationMs / total) * 100
          return (
            <div
              key={sp.spanId}
              className="grid items-center gap-2.5"
              style={{ gridTemplateColumns: '140px 1fr 120px' }}
            >
              <span
                className="truncate font-mono text-[11px]"
                style={{
                  color: bad ? 'var(--qw-danger)' : i === 0 ? 'var(--qw-fg)' : 'var(--qw-fg-muted)',
                  paddingLeft: i === 0 ? 0 : 12,
                  fontWeight: i === 0 ? 600 : 400,
                }}
              >
                {sp.name}
              </span>
              <div className="relative h-4">
                {sp.durationMs > 0 ? (
                  <div
                    className="absolute rounded-[4px]"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 1)}%`,
                      top: 2,
                      bottom: 2,
                      background: bad ? 'var(--qw-danger)' : 'var(--qw-crux)',
                      opacity: bad ? 0.9 : 0.5,
                    }}
                  />
                ) : (
                  <div
                    className="absolute"
                    style={{ left: 0, top: 7, height: 2, width: 16, background: 'var(--qw-border)' }}
                  />
                )}
              </div>
              <span
                className="text-right font-mono text-[10px]"
                style={{ color: bad ? 'var(--qw-danger)' : 'var(--qw-fg-faint)' }}
              >
                {fmtLatency(sp.durationMs)}
              </span>
            </div>
          )
        })
      ) : (
        <div className="font-mono text-[12px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {retainedTraceId
            ? 'trace retained; this cell did not emit child spans'
            : 'span detail not retained for this run'}
        </div>
      )}
      {trace.rootCause && (
        <div
          className="text-[11.5px] italic leading-[1.5]"
          style={{ color: 'var(--qw-fg-muted)', fontFamily: 'var(--qw-serif)' }}
        >
          {trace.rootCause.summary}
        </div>
      )}
      {retainedTraceId ? (
        <div className="mt-0.5">
          <Btn size="sm" icon={<Icon name="trace" size={12} />} onClick={() => onOpenTrace(retainedTraceId)}>
            Open full trace · {shortId(retainedTraceId)}
          </Btn>
        </div>
      ) : (
        <div className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          full trace detail not retained
        </div>
      )}
    </div>
  )
}
