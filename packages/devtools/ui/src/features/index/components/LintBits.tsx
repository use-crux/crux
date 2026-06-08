/**
 * Shared lint UI primitives used by both surfaces.
 *
 * The backend ships an authoritative read model — we render the fields,
 * we do not derive lint copy or remediation. This module centralizes the
 * presentation pieces that both the in-context Suggestions card
 * (`Index.tsx`) and the sweep-view detail panel (`IndexHealth.tsx`)
 * need, so the two surfaces stay visually and semantically in sync.
 *
 * Field → surface mapping (from the backend handoff):
 *   message      → "What"
 *   rationale    → "Why it matters"
 *   impact       → "Impact"
 *   evidence[]   → Evidence
 *   fixes[]      → Suggested fixes
 *   docsUrl OR fixes[kind=docs]     → Docs button
 *   suppression.directive OR fixes[kind=suppress] → suppress affordance
 *   relatedDefinitionIds → Related navigation
 *   affectedDefinitionIds → impact-scope chips
 *   propagated{DefinitionIds,Paths} → "reached via" / via-dependency badges
 */

import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { glyphFor, KindBadge } from '@/features/index/components/IndexKind'
import { normalizeKind, stripRoot } from '@/features/index/components/IndexTree'
import { cruxDocsUrl } from '@/shared/lib/cruxDocs'
import type { IndexLintFinding, ProjectDefinition } from '@/types'

type Severity = IndexLintFinding['severity']
type Fix = IndexLintFinding['fixes'][number]
type Evidence = IndexLintFinding['evidence'][number]

// ─── Tones ──────────────────────────────────────────────────────────

export function lintTone(severity: Severity) {
  if (severity === 'error') {
    return { fg: 'var(--qw-danger)', bg: 'var(--qw-danger-soft)', label: 'error' as const }
  }
  if (severity === 'warning') {
    return { fg: 'var(--qw-warn)', bg: 'var(--qw-warn-soft)', label: 'warning' as const }
  }
  return { fg: 'var(--qw-iris)', bg: 'var(--qw-iris-soft)', label: 'info' as const }
}

// ─── Severity chip ──────────────────────────────────────────────────

export function LintSeverityChip({ severity, count }: { severity: Severity; count?: number }) {
  const c = lintTone(severity)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-[7px] py-[2px] font-mono text-[11px] font-medium"
      style={{
        background: c.bg,
        color: c.fg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c.fg} 30%, transparent)`,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      <span className="inline-block rounded-full" style={{ width: 5, height: 5, background: c.fg }} />
      {c.label}
      {count != null && <span className="ml-0.5 font-mono text-[10.5px] opacity-80">{count}</span>}
    </span>
  )
}

// ─── Rule badge ─────────────────────────────────────────────────────

export function RuleBadge({ ruleId }: { ruleId: string }) {
  return (
    <span
      className="rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px]"
      style={{
        background: 'var(--qw-bg-muted)',
        color: 'var(--qw-fg-muted)',
        border: '1px solid var(--qw-border)',
        whiteSpace: 'nowrap',
      }}
      title={`rule · ${ruleId}`}
    >
      {ruleId}
    </span>
  )
}

// ─── Meta chips (category / maturity / confidence) ──────────────────

/** A tiny outlined chip — neutral by default, with optional tone for
 *  "this is notable, not the default." */
function MetaChip({
  label,
  fg = 'var(--qw-fg-muted)',
  border = 'var(--qw-border)',
  title,
}: {
  label: string
  fg?: string
  border?: string
  title?: string
}) {
  return (
    <span
      className="inline-flex items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px]"
      style={{
        color: fg,
        border: `1px solid ${border}`,
        background: 'var(--qw-bg)',
        whiteSpace: 'nowrap',
      }}
      title={title}
    >
      {label}
    </span>
  )
}

/** Render category / maturity / confidence side-by-side. Defaults
 *  (`stable`, `high`) are intentionally elided so the chip row stays
 *  quiet for the common case — non-defaults stand out. */
export function LintMetaChips({ finding }: { finding: IndexLintFinding }) {
  const items: React.ReactNode[] = []

  // Category is always rendered — it's a categorical label, useful for
  // scanning a list of mixed findings even when everything's "stable".
  items.push(<MetaChip key="cat" label={finding.category} title={`category · ${finding.category}`} />)

  if (finding.maturity !== 'stable') {
    const tone =
      finding.maturity === 'preview'
        ? { fg: 'var(--qw-warn)', border: 'color-mix(in srgb, var(--qw-warn) 35%, transparent)' }
        : { fg: 'var(--qw-iris)', border: 'color-mix(in srgb, var(--qw-iris) 35%, transparent)' }
    items.push(
      <MetaChip
        key="mat"
        label={finding.maturity}
        fg={tone.fg}
        border={tone.border}
        title={`maturity · ${finding.maturity}`}
      />,
    )
  }

  if (finding.confidence !== 'high') {
    const tone =
      finding.confidence === 'medium'
        ? { fg: 'var(--qw-crux)', border: 'var(--qw-crux-line)' }
        : { fg: 'var(--qw-fg-faint)', border: 'var(--qw-border)' }
    items.push(
      <MetaChip
        key="conf"
        label={`${finding.confidence} confidence`}
        fg={tone.fg}
        border={tone.border}
        title={`confidence · ${finding.confidence}`}
      />,
    )
  }

  return <>{items}</>
}

// ─── Resolved-docs / suppress helpers ───────────────────────────────

/** Resolve the docs link for a finding. The backend may ship it as the
 *  top-level `docsUrl`, on a fix with `kind === 'docs'`, or both — we
 *  prefer the top-level field per the handoff. */
export function resolveDocsHref(finding: IndexLintFinding): string | null {
  const direct = cruxDocsUrl(finding.docsUrl)
  if (direct) return direct
  const fix = finding.fixes.find((f) => f.kind === 'docs' && f.docsUrl)
  return fix ? cruxDocsUrl(fix.docsUrl) : null
}

/** Resolve the suppression directive (the comment to paste). Prefer
 *  `finding.suppression.directive`; fall back to a fix with
 *  `kind === 'suppress'` and a `suppression` payload. */
export function resolveSuppressDirective(finding: IndexLintFinding): string | null {
  if (finding.suppression?.directive) return finding.suppression.directive
  const fix = finding.fixes.find((f) => f.kind === 'suppress' && f.suppression)
  return fix?.suppression ?? null
}

// ─── Evidence list ──────────────────────────────────────────────────

const EVIDENCE_TONE: Record<Evidence['kind'], { fg: string; label: string }> = {
  definition: { fg: 'var(--qw-iris)', label: 'definition' },
  relation: { fg: 'var(--qw-fg-muted)', label: 'relation' },
  quality: { fg: 'var(--qw-ok)', label: 'quality' },
  runtime: { fg: 'var(--qw-crux)', label: 'runtime' },
  source: { fg: 'var(--qw-fg-muted)', label: 'source' },
}

/** Compact evidence list. Each row labels the kind, names the thing,
 *  and (when applicable) links into the index or shows file:line. */
export function EvidenceList({
  items,
  defsById,
  onSelect,
  projectRoot,
}: {
  items: readonly Evidence[]
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
  projectRoot: string | undefined
}) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((ev, i) => {
        const tone = EVIDENCE_TONE[ev.kind]
        const def = ev.definitionId ? defsById.get(ev.definitionId) : undefined
        const fileLabel = ev.source ? `${stripRoot(ev.source.file, projectRoot)}:${ev.source.line}` : undefined
        return (
          <div
            key={`${ev.kind}-${i}`}
            className="grid items-center gap-2 rounded-[6px] px-2.5 py-1.5"
            style={{
              gridTemplateColumns: 'auto minmax(0, 1fr) auto',
              background: 'var(--qw-bg)',
              border: '1px solid var(--qw-border)',
            }}
          >
            <span
              className="rounded-[3px] px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.06em]"
              style={{
                color: tone.fg,
                background: 'var(--qw-bg-muted)',
                border: '1px solid var(--qw-border)',
                whiteSpace: 'nowrap',
              }}
            >
              {tone.label}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px]" style={{ color: 'var(--qw-fg)' }}>
                {def ? (
                  <button
                    type="button"
                    onClick={() => onSelect(def.id)}
                    className="font-mono hover:underline"
                    style={{ color: 'var(--qw-crux)' }}
                  >
                    {def.name}
                  </button>
                ) : (
                  ev.label
                )}
              </span>
              {ev.description && (
                <span className="truncate text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
                  {ev.description}
                </span>
              )}
            </span>
            {fileLabel && (
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                {fileLabel}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Fix cards ──────────────────────────────────────────────────────

const FIX_KIND_LABEL: Record<Fix['kind'], string> = {
  manual: 'manual',
  docs: 'docs',
  config: 'config',
  suppress: 'suppress',
  'code-action': 'code action',
}

/** Render one fix. Kind drives the affordance:
 *  - `docs`        → "Read docs" link button using `fix.docsUrl`
 *  - `suppress`    → inline code chip with the directive to paste
 *  - `code-action` → "Apply" button (disabled — no backend apply path)
 *  - `manual`/`config` → description text, optional "Open file" button
 *
 *  Falls back gracefully when the optional fields are absent. */
export function FixCard({
  fix,
  severity,
  source,
  projectRoot,
}: {
  fix: Fix
  severity: Severity
  source: IndexLintFinding['source']
  projectRoot: string | undefined
}) {
  const c = lintTone(severity)
  const docsHref = fix.kind === 'docs' ? cruxDocsUrl(fix.docsUrl) : null
  const fileLabel = source ? `${stripRoot(source.file, projectRoot)}:${source.line}` : undefined
  return (
    <div
      className="rounded-[6px] px-3 py-2.5"
      style={{
        background: 'var(--qw-bg)',
        border: '1px solid var(--qw-border)',
      }}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: c.fg }}>
          {FIX_KIND_LABEL[fix.kind] ?? 'fix'}
        </span>
        <span className="text-[12.5px] font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {fix.title}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {fix.kind === 'docs' && docsHref && (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-[4px] border px-2 py-[3px] text-[11px] hover:bg-(--qw-bg-muted)"
              style={{ borderColor: 'var(--qw-border)', color: 'var(--qw-fg)' }}
            >
              <Icon name="book" size={10} /> Read docs
            </a>
          )}
          {fix.kind === 'code-action' && (
            <Btn
              size="xs"
              variant="primary"
              icon={<Icon name="play" size={10} />}
              disabled
              title="Apply not yet wired — apply this fix manually for now."
            >
              Apply
            </Btn>
          )}
          {source && (fix.kind === 'manual' || fix.kind === 'config') && (
            <Btn
              size="xs"
              icon={<Icon name="link" size={11} />}
              onClick={() => {
                window.location.href = `vscode://file${source.file}:${source.line}`
              }}
              title={`Open ${fileLabel}`}
            >
              Open file
            </Btn>
          )}
        </span>
      </div>
      <div className="text-[12px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)' }}>
        {fix.description}
      </div>
      {fix.kind === 'suppress' && fix.suppression && (
        <div className="mt-2">
          <code
            className="inline-block rounded-[3px] px-1.5 py-[2px] font-mono text-[10.5px]"
            style={{
              background: 'var(--qw-bg-muted)',
              color: 'var(--qw-fg)',
              border: '1px solid var(--qw-border)',
            }}
          >
            {fix.suppression}
          </code>
        </div>
      )}
      {fix.command && (
        <div className="mt-2 font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          <span style={{ color: 'var(--qw-fg-muted)' }}>$ </span>
          <code style={{ color: 'var(--qw-fg)' }}>{fix.command}</code>
        </div>
      )}
    </div>
  )
}

// ─── Affected-definitions chips ─────────────────────────────────────

/** Compact list of impacted definitions — used in the in-context card
 *  and the sweep-view detail panel to convey scope ("this finding
 *  affects N defs"). Clickable when the def is in the local map. */
export function AffectedDefList({
  ids,
  defsById,
  onSelect,
  max = 6,
}: {
  ids: readonly string[]
  defsById: Map<string, ProjectDefinition>
  onSelect: (id: string) => void
  max?: number
}) {
  if (ids.length === 0) return null
  const shown = ids.slice(0, max)
  const overflow = ids.length - shown.length
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((id) => {
        const def = defsById.get(id)
        if (!def) {
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[2px] font-mono text-[10.5px]"
              style={{
                borderColor: 'var(--qw-border)',
                color: 'var(--qw-fg-faint)',
                background: 'var(--qw-bg)',
              }}
              title={id}
            >
              {id}
            </span>
          )
        }
        const g = glyphFor(def.kind)
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(def.id)}
            className="inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[2px] font-mono text-[11px] hover:bg-(--qw-bg-muted)"
            style={{
              borderColor: 'var(--qw-border)',
              color: 'var(--qw-fg)',
              background: 'var(--qw-bg)',
            }}
            title={`Open ${def.name} (${normalizeKind(def.kind)})`}
          >
            <KindBadge name={g.icon} color={g.color} size={14} />
            <span className="truncate" style={{ maxWidth: 160 }}>
              {def.name}
            </span>
          </button>
        )
      })}
      {overflow > 0 && (
        <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          +{overflow} more
        </span>
      )}
    </div>
  )
}
