/**
 * Quality kit — the design-system vocabulary for the Quality workbench.
 *
 * Builds ON the shared primitives (Chip, Btn, Icon). Everything here is the
 * vocabulary the workbench needs that the shared kit doesn't already own:
 *   · the honest VERDICT states (passed / failed / informational / running)
 *   · the cell STATUS taxonomy (passed ≠ failed ≠ errored ≠ skipped)
 *   · the REPLAY posture badge (live / record / replay / refresh / stale)
 *   · the ±SEM error bar + ScoreStat + DeltaStat (never a bare number)
 *   · the GateRow (blocking vs informational)
 *   · the task-kind identity (prompt / flow / agent / retriever / fn)
 *   · the scorer cost-class chip (code vs model judge)
 *
 * All colour resolves through `--qw-*` CSS vars so light/dark just works.
 * The single trust rule everything serves: a number that could carry
 * uncertainty always wears its error bar; a rule-failure never looks like a
 * crash; a deliberate skip never looks like a failure; informational is
 * neither pass nor fail; replay posture is always visible.
 */

import * as React from 'react'
import { cn } from '@/shared/lib/utils'
import { Icon } from './Icon'
import type { IconName } from './nav'
import { Btn, Chip } from './primitives'

// ─── Tone resolution ────────────────────────────────────────────────

export type QTone = 'crux' | 'danger' | 'warn' | 'ok' | 'iris' | 'blue' | 'gold' | 'plum' | 'muted'

interface ToneVars {
  fg: string
  soft: string
  line: string
}

function toneVars(tone: QTone): ToneVars {
  if (tone === 'muted') return { fg: 'var(--qw-fg-muted)', soft: 'var(--qw-bg-muted)', line: 'var(--qw-border)' }
  return { fg: `var(--qw-${tone})`, soft: `var(--qw-${tone}-soft)`, line: `var(--qw-${tone}-line)` }
}

function toneColor(tone: QTone | undefined): string {
  if (!tone) return 'var(--qw-fg)'
  if (tone === 'muted') return 'var(--qw-fg-muted)'
  return `var(--qw-${tone})`
}

// ─── Task-kind identity ─────────────────────────────────────────────
// What kind of thing an evaluation tests. A strong visual category.
// prompt=authoring(iris) · flow=orchestration(blue) · agent=agents(crux) ·
// retriever=capabilities(ok) · fn=neutral.

export type TaskKind = 'prompt' | 'flow' | 'agent' | 'retriever' | 'fn'

interface TaskKindMeta {
  label: string
  tone: QTone
  glyph: IconName
}

export const TASK_KINDS: Record<TaskKind, TaskKindMeta> = {
  prompt: { label: 'prompt', tone: 'iris', glyph: 'doc' },
  flow: { label: 'flow', tone: 'blue', glyph: 'branch' },
  agent: { label: 'agent', tone: 'crux', glyph: 'bot' },
  retriever: { label: 'retriever', tone: 'ok', glyph: 'search' },
  fn: { label: 'fn', tone: 'muted', glyph: 'grid' },
}

function taskMeta(kind: string | undefined): TaskKindMeta {
  return (kind && (TASK_KINDS as Record<string, TaskKindMeta>)[kind]) || TASK_KINDS.fn
}

/**
 * Derive a task kind from an evaluation/experiment id. Summary rows don't
 * carry the kind, but spec-02 ids are conventionally `<kind>.<name>`
 * (`flow.rfp-writer`, `agent.support-triage`). Falls back to `fn`.
 */
export function taskKindFromId(evaluationId: string | undefined): TaskKind {
  const head = (evaluationId ?? '').split('.')[0]
  return head in TASK_KINDS ? (head as TaskKind) : 'fn'
}

export function TaskGlyph({ kind, size = 26 }: { kind: string; size?: number }) {
  const meta = taskMeta(kind)
  const c = toneVars(meta.tone)
  return (
    <div
      title={meta.label}
      className="flex shrink-0 items-center justify-center rounded-[7px]"
      style={{ width: size, height: size, background: c.soft, boxShadow: `inset 0 0 0 1px ${c.line}`, color: c.fg }}
    >
      <Icon name={meta.glyph} size={Math.round(size * 0.56)} color={c.fg} />
    </div>
  )
}

export function TaskKindTag({ kind, mono = true }: { kind: string; mono?: boolean }) {
  const meta = taskMeta(kind)
  const c = toneVars(meta.tone)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-[5px] whitespace-nowrap rounded-[4px] px-[7px] py-[2px] text-[10.5px] font-semibold uppercase tracking-[0.06em]',
        mono && 'font-mono',
      )}
      style={{ color: c.fg, background: c.soft, boxShadow: `inset 0 0 0 1px ${c.line}` }}
    >
      <Icon name={meta.glyph} size={11} color={c.fg} />
      {meta.label}
    </span>
  )
}

// ─── VERDICT — the headline pass / fail / informational state ────────
// Three states + running. informational is neither green nor red — it's the
// muted "couldn't truly block" state (filtered run, no baseline, drift).

export type VerdictState = 'passed' | 'failed' | 'informational' | 'running'

const VERDICTS: Record<VerdictState, { tone: QTone; icon: IconName; label: string }> = {
  passed: { tone: 'ok', icon: 'check', label: 'Passed' },
  failed: { tone: 'danger', icon: 'x', label: 'Failed' },
  informational: { tone: 'muted', icon: 'info', label: 'Informational' },
  running: { tone: 'crux', icon: 'loop', label: 'Running' },
}

export function Verdict({
  state = 'passed',
  size = 'md',
  sub,
}: {
  state?: VerdictState
  size?: 'md' | 'lg'
  sub?: React.ReactNode
}) {
  const v = VERDICTS[state] ?? VERDICTS.informational
  const isInfo = state === 'informational'
  const col = isInfo ? 'var(--qw-fg-muted)' : toneColor(v.tone)
  const soft = isInfo ? 'var(--qw-bg-muted)' : `var(--qw-${v.tone}-soft)`
  const line = isInfo ? 'var(--qw-border-strong)' : `var(--qw-${v.tone}-line)`
  const big = size === 'lg'
  const pulse = state === 'running'
  return (
    <div
      className="inline-flex items-center"
      style={{
        gap: big ? 12 : 8,
        padding: big ? '10px 16px' : '5px 10px',
        borderRadius: big ? 10 : 6,
        background: soft,
        boxShadow: `inset 0 0 0 1px ${line}`,
        color: col,
      }}
    >
      <span
        className="flex shrink-0 items-center justify-center"
        style={{
          width: big ? 26 : 16,
          height: big ? 26 : 16,
          borderRadius: big ? 7 : 5,
          background: isInfo ? 'transparent' : col,
          boxShadow: isInfo ? `inset 0 0 0 1.5px ${col}` : 'none',
          ...(pulse ? { animation: 'cat-pulse 1.4s ease-in-out infinite' } : {}),
        }}
      >
        <Icon name={v.icon} size={big ? 15 : 10} color={isInfo ? col : 'var(--qw-bg)'} strokeWidth={2.2} />
      </span>
      <div className="flex flex-col leading-[1.15]">
        <span style={{ fontSize: big ? 16 : 12.5, fontWeight: 650, letterSpacing: '-0.01em' }}>{v.label}</span>
        {sub != null && (
          <span className="font-mono font-normal" style={{ fontSize: big ? 11.5 : 10.5, color: 'var(--qw-fg-muted)' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── CELL STATUS — the debugging atom's four honest states ───────────
// passed (rule held) · failed (a rule/score failed) · errored (task/harness
// crashed) · skipped (deliberately not run). These MUST look different.

export type CellStatus = 'passed' | 'failed' | 'errored' | 'skipped'

const CELL_STATUS: Record<CellStatus, { tone: QTone; glyph: string; icon: IconName | null; crash?: boolean; faint?: boolean }> = {
  passed: { tone: 'ok', glyph: '●', icon: 'check' },
  failed: { tone: 'danger', glyph: '✕', icon: 'x' },
  errored: { tone: 'danger', glyph: '!', icon: 'alert', crash: true },
  skipped: { tone: 'muted', glyph: '–', icon: null, faint: true },
}

export function CellStatusChip({ status = 'passed', showLabel = true }: { status?: CellStatus; showLabel?: boolean }) {
  const m = CELL_STATUS[status] ?? CELL_STATUS.skipped
  const col = m.tone === 'muted' ? 'var(--qw-fg-faint)' : `var(--qw-${m.tone})`
  const soft = m.tone === 'muted' ? 'var(--qw-bg-muted)' : `var(--qw-${m.tone}-soft)`
  const ring = m.tone === 'muted' ? 'var(--qw-border)' : `var(--qw-${m.tone}-line)`
  return (
    <span
      className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-[4px] px-2 py-[2px] font-mono text-[11px] font-semibold"
      style={{
        color: col,
        background: m.crash
          ? `repeating-linear-gradient(135deg, ${soft}, ${soft} 4px, transparent 4px, transparent 8px)`
          : soft,
        boxShadow: `inset 0 0 0 1px ${ring}`,
        border: status === 'skipped' ? '1px dashed var(--qw-border)' : 'none',
        opacity: m.faint ? 0.85 : 1,
      }}
    >
      {m.icon ? <Icon name={m.icon} size={10} color={col} strokeWidth={2.4} /> : <span>{m.glyph}</span>}
      {showLabel && status}
    </span>
  )
}

// ─── REPLAY posture — always visible ────────────────────────────────

const REPLAY_MODES: Record<string, { tone: QTone; icon: IconName; label: string; hint: string }> = {
  live: {
    tone: 'crux',
    icon: 'play',
    label: 'live',
    hint: 'Live — real model calls were made and paid for. Non-deterministic: re-running can give different numbers.',
  },
  'record-new': {
    tone: 'iris',
    icon: 'cassette',
    label: 'recording',
    hint: 'Recording — calls were made once and saved into a cassette so future runs can replay them.',
  },
  'replay-strict': {
    tone: 'blue',
    icon: 'cassette',
    label: 'replay',
    hint: 'Replay — no model calls; replayed deterministically from a cassette. Free and CI-safe; a missing entry errors the cell instead of calling the model.',
  },
  refresh: {
    tone: 'warn',
    icon: 'loop',
    label: 'refresh',
    hint: 'Refresh — the cassette was re-recorded, replacing the previous recording.',
  },
}

export function ReplayBadge({ mode = 'live', stale = false, size = 'sm' }: { mode?: string; stale?: boolean; size?: 'sm' | 'md' }) {
  const m = REPLAY_MODES[mode] ?? { tone: 'muted' as QTone, icon: 'cassette' as IconName, label: mode, hint: mode }
  const col = toneColor(m.tone)
  const soft = m.tone === 'muted' ? 'var(--qw-bg-muted)' : `var(--qw-${m.tone}-soft)`
  const line = m.tone === 'muted' ? 'var(--qw-border)' : `var(--qw-${m.tone}-line)`
  const sm = size === 'sm'
  const pad = sm ? '2px 7px' : '3px 9px'
  const fs = sm ? 10.5 : 11.5
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        title={m.hint}
        className="inline-flex items-center gap-[5px] whitespace-nowrap rounded-[4px] font-mono font-semibold uppercase tracking-[0.04em]"
        style={{ padding: pad, fontSize: fs, color: col, background: soft, boxShadow: `inset 0 0 0 1px ${line}` }}
      >
        {mode === 'live' ? (
          <span
            className="rounded-full"
            style={{ width: 5, height: 5, background: col, animation: 'cat-pulse 1.4s ease-in-out infinite' }}
          />
        ) : (
          <Icon name={m.icon} size={11} color={col} />
        )}
        {m.label}
      </span>
      {stale && (
        <span
          title="cassette older than 90 days — replay may be wrong; re-record"
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-[4px] font-mono font-semibold uppercase tracking-[0.04em]"
          style={{
            padding: pad,
            fontSize: fs,
            color: 'var(--qw-warn)',
            background: 'var(--qw-warn-soft)',
            boxShadow: 'inset 0 0 0 1px var(--qw-warn-line)',
          }}
        >
          <Icon name="alert" size={11} color="var(--qw-warn)" /> stale
        </span>
      )}
    </span>
  )
}

// ─── ERROR BAR — the signature trust glyph. A point with ±SEM whiskers ──

export function ErrorBar({
  value,
  sem = 0,
  max = 1,
  width = 72,
  tone,
  height = 26,
}: {
  value: number
  sem?: number
  max?: number
  width?: number
  tone?: QTone
  height?: number
}) {
  const col = toneColor(tone)
  const clamp = (v: number) => Math.max(0, Math.min(1, v / max)) * width
  const cx = clamp(value)
  const lo = clamp(value - sem)
  const hi = clamp(value + sem)
  const midY = height / 2
  return (
    <svg width={width} height={height} className="block overflow-visible" aria-hidden>
      <line x1={0} y1={midY} x2={width} y2={midY} stroke="var(--qw-border)" strokeWidth={1} />
      <line x1={lo} y1={midY} x2={hi} y2={midY} stroke={col} strokeWidth={2} opacity={0.45} />
      <line x1={lo} y1={midY - 4} x2={lo} y2={midY + 4} stroke={col} strokeWidth={1.4} opacity={0.6} />
      <line x1={hi} y1={midY - 4} x2={hi} y2={midY + 4} stroke={col} strokeWidth={1.4} opacity={0.6} />
      <circle cx={cx} cy={midY} r={3.4} fill={col} />
    </svg>
  )
}

// A score mean rendered honestly: big number + faint ±sem + a small bar.
export function ScoreStat({
  value,
  sem,
  label,
  max = 1,
  tone,
  n,
  width = 76,
  size = 'md',
}: {
  value: number | null | undefined
  sem?: number
  label?: React.ReactNode
  max?: number
  tone?: QTone
  n?: number
  width?: number
  size?: 'md' | 'lg'
}) {
  const isNull = value == null
  const big = size === 'lg'
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: big ? 6 : 4 }}>
      {label != null && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
          {label}
        </span>
      )}
      {isNull ? (
        <span
          title="couldn't score — not the same as 0"
          className="font-mono font-semibold"
          style={{ fontSize: big ? 21 : 15, color: 'var(--qw-fg-faint)' }}
        >
          n/a
        </span>
      ) : (
        <>
          <div className="flex items-baseline gap-[5px]">
            <span
              className="font-mono"
              style={{ fontSize: big ? 28 : 16, fontWeight: 650, letterSpacing: '-0.01em', color: 'var(--qw-fg)' }}
            >
              {value.toFixed(2)}
            </span>
            {sem != null && (
              <span className="font-mono" style={{ fontSize: big ? 13.5 : 11.5, color: 'var(--qw-fg-faint)' }}>
                ±{sem.toFixed(2)}
              </span>
            )}
          </div>
          <ErrorBar value={value} sem={sem ?? 0} max={max} width={width} tone={tone} height={big ? 22 : 16} />
          {n != null && (
            <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
              n={n}
            </span>
          )}
        </>
      )}
    </div>
  )
}

// ─── DELTA — better or worse, and is it real? Never a bare number. ───
// If |Δ| ≤ sem the difference is within the error bar — render it neutral and
// say "within noise". Honesty over a green arrow.

export function DeltaStat({
  delta,
  sem = 0,
  prefix = 'Δ',
  size = 'md',
}: {
  delta: number
  sem?: number
  prefix?: string
  size?: 'md' | 'lg'
}) {
  const noise = Math.abs(delta) <= sem
  const col = noise ? 'var(--qw-fg-muted)' : delta > 0 ? 'var(--qw-ok)' : 'var(--qw-danger)'
  const big = size === 'lg'
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      <span className="inline-flex items-baseline gap-[3px]" style={{ color: col, fontWeight: 650, fontSize: big ? 16 : 12.5 }}>
        {!noise && <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} size={big ? 13 : 11} color={col} strokeWidth={2.4} />}
        {prefix} {delta > 0 ? '+' : ''}
        {delta.toFixed(2)}
        <span style={{ color: 'var(--qw-fg-faint)', fontWeight: 400, fontSize: big ? 12.5 : 11 }}>±{sem.toFixed(2)}</span>
      </span>
      {noise && (
        <span
          className="rounded-[3px] px-1 py-px text-[10px] uppercase tracking-[0.06em]"
          style={{ color: 'var(--qw-fg-faint)', border: '1px solid var(--qw-border)' }}
        >
          within noise
        </span>
      )}
    </span>
  )
}

// ─── GATE ROW — a threshold the experiment must clear ───────────────
// Blocking vs informational are visually distinct; informational never fails.

export function GateRow({
  gate,
  threshold,
  actual,
  passed,
  informational,
  variant,
  last,
}: {
  gate: string
  threshold: unknown
  actual: unknown
  passed: boolean
  informational?: boolean
  variant?: string
  last?: boolean
}) {
  const fmt = (v: unknown) =>
    typeof v === 'boolean' ? (v ? 'true' : 'false') : typeof v === 'number' ? v.toFixed(2) : String(v)
  const col = informational ? 'var(--qw-fg-muted)' : passed ? 'var(--qw-ok)' : 'var(--qw-danger)'
  return (
    <div
      className="grid items-center gap-3 px-4 py-2.5"
      style={{
        gridTemplateColumns: '20px 1fr 92px 92px 96px',
        borderBottom: last ? 'none' : '1px solid var(--qw-border)',
        background: !informational && !passed ? 'var(--qw-danger-soft)' : 'transparent',
      }}
    >
      <span
        className="flex items-center justify-center rounded-[5px]"
        style={{
          width: 18,
          height: 18,
          background: informational ? 'transparent' : col,
          boxShadow: informational ? 'inset 0 0 0 1.4px var(--qw-border-strong)' : 'none',
        }}
      >
        <Icon
          name={informational ? 'info' : passed ? 'check' : 'x'}
          size={11}
          color={informational ? 'var(--qw-fg-muted)' : 'var(--qw-bg)'}
          strokeWidth={2.4}
        />
      </span>
      <div className="min-w-0">
        <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--qw-fg)' }}>
          {gate}
        </span>
        {variant && (
          <span className="ml-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
            · {variant}
          </span>
        )}
      </div>
      <span className="text-right font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {fmt(threshold)}
      </span>
      <span className="text-right font-mono text-[12.5px] font-semibold" style={{ color: col }}>
        {fmt(actual)}
      </span>
      <div className="flex justify-end">
        {informational ? (
          <Chip tone="muted" mono>
            info · can&rsquo;t block
          </Chip>
        ) : (
          <Chip tone={passed ? 'ok' : 'danger'} dot>
            {passed ? 'pass' : 'fail'}
          </Chip>
        )}
      </div>
    </div>
  )
}

// ─── SCORER chip — code (deterministic) vs model (LLM judge) ─────────

export function ScorerChip({ name, costClass = 'code', mean }: { name: string; costClass?: string; mean?: number }) {
  const isModel = costClass === 'model'
  const col = isModel ? 'var(--qw-gold)' : 'var(--qw-fg-muted)'
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[5px] px-[9px] py-[3px] font-mono text-[11.5px]"
      style={{
        background: isModel ? 'var(--qw-gold-soft)' : 'var(--qw-bg-muted)',
        boxShadow: `inset 0 0 0 1px ${isModel ? 'var(--qw-gold-line)' : 'var(--qw-border)'}`,
        color: 'var(--qw-fg)',
      }}
    >
      <Icon name={isModel ? 'sparkle' : 'check'} size={11} color={col} />
      <span className="font-medium">{name}</span>
      <span className="text-[9.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--qw-fg-faint)' }}>
        {isModel ? 'judge' : 'code'}
      </span>
      {mean != null && (
        <span className="font-semibold" style={{ color: col }}>
          {mean.toFixed(2)}
        </span>
      )}
    </span>
  )
}

// ─── Empty / loading / error / not-found — never-a-blank-screen ──────

export function QEmpty({
  icon = 'flask',
  title,
  body,
  action,
  tone,
}: {
  icon?: IconName
  title: React.ReactNode
  body?: React.ReactNode
  action?: React.ReactNode
  tone?: QTone
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-[12px]"
        style={{ background: tone ? `var(--qw-${tone}-soft)` : 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
      >
        <Icon name={icon} size={22} color={tone ? `var(--qw-${tone})` : 'var(--qw-fg-muted)'} />
      </div>
      <div className="text-[16px] font-semibold">{title}</div>
      {body && (
        <div className="max-w-[360px] text-[12.5px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)' }}>
          {body}
        </div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

// A read-only CLI command block — runs are launched from the CLI; the UI
// observes. Copy-to-run affordance, never a fake run button.
export function CliHint({ cmd, note }: { cmd: string; note?: React.ReactNode }) {
  const [copied, setCopied] = React.useState(false)
  const copy = React.useCallback(() => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }, [cmd])
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex items-center gap-2.5 rounded-[7px] px-3 py-[9px] font-mono text-[12px]"
        style={{ background: 'var(--qw-bg-subtle)', boxShadow: 'inset 0 0 0 1px var(--qw-border)', color: 'var(--qw-fg)' }}
      >
        <span style={{ color: 'var(--qw-fg-faint)' }}>$</span>
        <span className="flex-1 truncate">{cmd}</span>
        <Btn size="xs" icon={<Icon name={copied ? 'check' : 'doc'} size={12} />} onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Btn>
      </div>
      {note && (
        <span className="text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {note}
        </span>
      )}
    </div>
  )
}

// ─── Shared formatters reused across the workbench ──────────────────

export function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const ts = Date.parse(iso)
  if (!ts) return iso
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function shortId(id: string, keep = 8): string {
  return id.length > keep + 2 ? `${id.slice(0, keep)}` : id
}

export function fmtPct(n: number | null | undefined): string {
  return n != null ? `${Math.round(n * 100)}%` : '—'
}

export function fmtCost(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

export function fmtLatency(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return '—'
  return b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`
}
