/**
 * Index · Health — sweep view for index lint findings.
 *
 * Opt-in surface, opened from the `Health · N` button on the Index
 * header. The design intent (see `v4-index-lints.jsx` → V4IndexLintsSweep)
 * is the "I want to clean up the project" view, not the daily-driver
 * view. So:
 *
 *  - Findings are grouped by ruleId so duplicates collapse — e.g. five
 *    tools without an input schema become one expandable group, not five
 *    scattered cards.
 *  - KPI strip up top: total · warnings · info · suppressed.
 *  - Filter row: severity chips toggle, kind chips, "changed since
 *    baseline" filter, group-by switch (rule | file | kind).
 *  - Two columns: groups on the left, sticky detail panel on the right
 *    showing What / Why it matters / Suggested fix / Related / Suppress
 *    hint for the selected finding.
 *
 * All data comes from the same `/api/index.lintFindings` payload as
 * the in-context Suggestions section. No client-side derivation — the
 * backend owns rule metadata, propagation, suppression resolution, and
 * docs URLs. Suppressed findings are surfaced as a count in the KPI
 * strip and a dashed footer (so they're visible without polluting the
 * inbox).
 */

import { useMemo, useState } from 'react'
import { QwShell, type QwTab } from '@/qw/shell/QwShell'
import { Btn, Chip, Kpi, type ChipTone } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { useNavigation } from '@/app/navigation/useNavigation'
import { navTarget } from '@/app/navigation/navTarget'
import { glyphFor, KindBadge } from '@/features/index/components/IndexKind'
import { normalizeKind, stripRoot } from '@/features/index/components/IndexTree'
import {
  AffectedDefList,
  EvidenceList,
  FixCard,
  LintMetaChips,
  LintSeverityChip,
  RuleBadge,
  lintTone,
  resolveDocsHref,
  resolveSuppressDirective,
} from '@/features/index/components/LintBits'
import { cruxDocsUrl } from '@/shared/lib/cruxDocs'
import type { IndexLintFinding, ProjectDefinition } from '@/types'

type Severity = IndexLintFinding['severity']
type GroupKey = 'rule' | 'file' | 'kind'

const SEV_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

function fmtIndexedAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const sameDay = new Date().toDateString() === d.toDateString()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface IndexHealthProps {
  definitions: readonly ProjectDefinition[]
  lintFindings: readonly IndexLintFinding[]
  suppressedCount: number
  indexedAt: string | undefined
  projectRoot: string | undefined
  connected: boolean
  /** Shared tab strip — owned by `IndexView` so both surfaces stay
   *  in sync. Passed through to `QwShell` unchanged. */
  tabs?: readonly QwTab[]
}

export function IndexHealth({
  definitions,
  lintFindings,
  suppressedCount,
  indexedAt,
  projectRoot,
  connected,
  tabs,
}: IndexHealthProps) {
  const { navigate } = useNavigation()

  const defsById = useMemo(() => {
    const m = new Map<string, ProjectDefinition>()
    for (const d of definitions) m.set(d.id, d)
    return m
  }, [definitions])

  // Filter state — local to the page, no URL persistence. The design
  // assumes you open Health, sweep, and then close it.
  const [severityFilter, setSeverityFilter] = useState<Set<Severity>>(new Set(['error', 'warning', 'info']))
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [groupBy, setGroupBy] = useState<GroupKey>('rule')
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null)

  const visible = useMemo(
    () =>
      lintFindings.filter((f) => {
        if (f.suppressed) return false
        if (!severityFilter.has(f.severity)) return false
        if (kindFilter !== 'all') {
          // Resolve via primary def if available; fall back to first
          // related def. Findings whose target def we cannot resolve
          // pass the kind filter so they remain visible during loading.
          const targetId = f.primaryDefinitionId ?? f.relatedDefinitionIds?.[0]
          const target = targetId ? defsById.get(targetId) : undefined
          if (target && normalizeKind(target.kind) !== kindFilter) return false
        }
        return true
      }),
    [lintFindings, severityFilter, kindFilter, defsById],
  )

  // KPI counters use the visible-pre-kind-filter total because the
  // strip is meta — it tells you how big the queue actually is.
  const totalUnsuppressed = useMemo(() => lintFindings.filter((f) => !f.suppressed).length, [lintFindings])
  const warnCount = useMemo(
    () => lintFindings.filter((f) => !f.suppressed && (f.severity === 'warning' || f.severity === 'error')).length,
    [lintFindings],
  )
  const infoCount = useMemo(
    () => lintFindings.filter((f) => !f.suppressed && f.severity === 'info').length,
    [lintFindings],
  )
  const affectedDefs = useMemo(() => {
    const s = new Set<string>()
    for (const f of lintFindings) {
      if (f.suppressed) continue
      if (f.primaryDefinitionId) s.add(f.primaryDefinitionId)
      for (const id of f.relatedDefinitionIds ?? []) s.add(id)
    }
    return s.size
  }, [lintFindings])

  // Group the filtered findings by the chosen grouping key.
  const groups = useMemo(() => {
    const m = new Map<string, IndexLintFinding[]>()
    for (const f of visible) {
      let key: string
      if (groupBy === 'file') key = f.source?.file ?? '(no source)'
      else if (groupBy === 'kind') {
        const targetId = f.primaryDefinitionId ?? f.relatedDefinitionIds?.[0]
        const t = targetId ? defsById.get(targetId) : undefined
        key = t ? normalizeKind(t.kind) : '(unknown kind)'
      } else key = f.ruleId
      const arr = m.get(key)
      if (arr) arr.push(f)
      else m.set(key, [f])
    }
    // Sort group keys: by worst severity ascending (errors first), then
    // by descending count, then alphabetically.
    const arr = Array.from(m.entries()).map(([key, items]) => {
      const worst = items.reduce<Severity>(
        (acc, f) => (SEV_RANK[f.severity] < SEV_RANK[acc] ? f.severity : acc),
        'info',
      )
      return { key, items, worstSeverity: worst }
    })
    arr.sort((a, b) => {
      if (a.worstSeverity !== b.worstSeverity) return SEV_RANK[a.worstSeverity] - SEV_RANK[b.worstSeverity]
      if (b.items.length !== a.items.length) return b.items.length - a.items.length
      return a.key.localeCompare(b.key)
    })
    return arr
  }, [visible, groupBy, defsById])

  // Auto-select the first finding when nothing is selected, so the
  // sticky right panel always has content to render.
  const selectedFinding = useMemo(() => {
    if (selectedFindingId) {
      const hit = visible.find((f) => f.id === selectedFindingId)
      if (hit) return hit
    }
    return visible[0] ?? null
  }, [selectedFindingId, visible])

  // Kind chip set is derived from the kinds the user actually has
  // findings on — no point offering "scorer" if no scorer has lints.
  const kindOptions = useMemo(() => {
    const s = new Set<string>()
    for (const f of lintFindings) {
      if (f.suppressed) continue
      const targetId = f.primaryDefinitionId ?? f.relatedDefinitionIds?.[0]
      const t = targetId ? defsById.get(targetId) : undefined
      if (t) s.add(normalizeKind(t.kind))
    }
    return Array.from(s).sort()
  }, [lintFindings, defsById])

  function toggleSeverity(sev: Severity) {
    setSeverityFilter((prev) => {
      const next = new Set(prev)
      if (next.has(sev)) next.delete(sev)
      else next.add(sev)
      // Don't allow empty set — fall back to all-on.
      if (next.size === 0) return new Set(['error', 'warning', 'info'])
      return next
    })
  }

  const indexed = fmtIndexedAt(indexedAt)
  const subtitle =
    totalUnsuppressed === 0
      ? 'No suggestions in the index.'
      : [
          `${totalUnsuppressed} suggestion${totalUnsuppressed === 1 ? '' : 's'} across ${affectedDefs} definition${affectedDefs === 1 ? '' : 's'}`,
          warnCount > 0 && `${warnCount} warning${warnCount === 1 ? '' : 's'}`,
          infoCount > 0 && `${infoCount} info`,
          indexed && `indexed ${indexed}`,
        ]
          .filter(Boolean)
          .join(' · ')

  return (
    <QwShell
      activeView="library-index"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Index / Health"
      title="Index health"
      subtitle={subtitle}
      connected={connected}
      tabs={tabs}
    >
      <div className="px-8 pt-5 pb-10">
        {/* KPI strip */}
        <div className="mb-5 grid grid-cols-4 gap-3">
          <Kpi
            label="Suggestions"
            value={String(totalUnsuppressed)}
            sublabel={`${affectedDefs} definition${affectedDefs === 1 ? '' : 's'} affected`}
          />
          <Kpi label="Warnings" value={String(warnCount)} sublabel="worth fixing soon" />
          <Kpi label="Info" value={String(infoCount)} sublabel="nudges" />
          <Kpi
            label="Suppressed"
            value={String(suppressedCount)}
            sublabel={
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
                // crux-lint-disable
              </span>
            }
          />
        </div>

        {/* Filter row */}
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-[8px] px-3.5 py-2.5"
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        >
          <span className="text-[10px] font-mono uppercase tracking-[0.1em]" style={{ color: 'var(--qw-fg-faint)' }}>
            Filter
          </span>
          {(['warning', 'info'] as Severity[]).map((sev) => {
            const on = severityFilter.has(sev)
            const counts = lintFindings.filter(
              (f) =>
                !f.suppressed &&
                (sev === 'warning' ? f.severity === 'warning' || f.severity === 'error' : f.severity === 'info'),
            ).length
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSeverity(sev)}
                title={`Toggle ${sev}`}
                style={{ opacity: on ? 1 : 0.4 }}
              >
                <LintSeverityChip severity={sev} count={counts} />
              </button>
            )
          })}
          <span
            aria-hidden
            style={{
              width: 1,
              height: 16,
              background: 'var(--qw-border)',
              margin: '0 4px',
            }}
          />
          {/* Kind filter chips */}
          <button type="button" onClick={() => setKindFilter('all')} title="Show every kind">
            <Chip tone={kindFilter === 'all' ? 'crux' : 'muted'} mono>
              all kinds
            </Chip>
          </button>
          {kindOptions.map((k) => {
            const tone: ChipTone = kindFilter === k ? 'crux' : 'muted'
            return (
              <button key={k} type="button" onClick={() => setKindFilter(k)} title={`Filter by ${k}`}>
                <Chip tone={tone} mono>
                  {k}
                </Chip>
              </button>
            )
          })}
          <span className="ml-auto flex items-center gap-1.5">
            <span className="font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
              group by
            </span>
            {(['rule', 'file', 'kind'] as GroupKey[]).map((g) => (
              <Btn key={g} size="xs" variant={groupBy === g ? 'primary' : undefined} onClick={() => setGroupBy(g)}>
                {g}
              </Btn>
            ))}
          </span>
        </div>

        {/* Two columns: groups (L) + sticky detail (R) */}
        {visible.length === 0 ? (
          <div
            className="rounded-[10px] py-12 text-center text-[13px]"
            style={{
              background: 'var(--qw-bg-elev)',
              border: '1px solid var(--qw-border)',
              color: 'var(--qw-fg-muted)',
            }}
          >
            {totalUnsuppressed === 0
              ? 'Nothing to clean up — every index definition is in good shape.'
              : 'No suggestions match the current filters.'}
          </div>
        ) : (
          <div className="grid gap-[18px]" style={{ gridTemplateColumns: '1.45fr 1fr' }}>
            {/* Left column — grouped findings */}
            <div className="flex flex-col gap-3">
              {groups.map(({ key, items, worstSeverity }) => {
                const rule = items[0]!
                const groupTitle =
                  groupBy === 'rule' ? rule.title : groupBy === 'file' ? stripRoot(key, projectRoot) : key
                return (
                  <div
                    key={key}
                    className="overflow-hidden rounded-[10px]"
                    style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
                  >
                    <div
                      className="grid items-center gap-2.5 px-3.5 py-2.5"
                      style={{
                        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                        background: 'var(--qw-bg-muted)',
                        borderBottom: '1px solid var(--qw-border)',
                      }}
                    >
                      <LintSeverityChip severity={worstSeverity} count={items.length} />
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-[13px] font-semibold">{groupTitle}</span>
                        {groupBy === 'rule' && <RuleBadge ruleId={key} />}
                      </span>
                      {groupBy === 'rule' &&
                        (() => {
                          const href = cruxDocsUrl(rule.docsUrl)
                          if (!href) return null
                          return (
                            <a
                              href={href}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-[4px] border px-2 py-[3px] text-[11px] hover:bg-(--qw-bg)"
                              style={{ borderColor: 'var(--qw-border)', color: 'var(--qw-fg-muted)' }}
                            >
                              <Icon name="book" size={11} /> Docs
                            </a>
                          )
                        })()}
                    </div>
                    {items.map((f, i) => {
                      const targetId = f.primaryDefinitionId ?? f.relatedDefinitionIds?.[0]
                      const target = targetId ? defsById.get(targetId) : undefined
                      const sel = selectedFinding?.id === f.id
                      const g = target
                        ? glyphFor(target.kind)
                        : {
                            icon: 'doc' as const,
                            color: 'var(--qw-fg-muted)',
                            tone: 'muted' as const,
                            label: 'unknown',
                          }
                      return (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setSelectedFindingId(f.id)}
                          className="grid w-full items-center gap-2.5 px-3.5 py-2 text-left transition-colors hover:bg-(--qw-bg-muted)"
                          style={{
                            gridTemplateColumns: '22px minmax(120px, 220px) minmax(0, 1fr) auto',
                            borderBottom: i === items.length - 1 ? 'none' : '1px solid var(--qw-border)',
                            background: sel ? 'var(--qw-crux-soft)' : 'transparent',
                            boxShadow: sel ? 'inset 3px 0 0 var(--qw-crux)' : 'none',
                          }}
                        >
                          <KindBadge name={g.icon} color={g.color} size={18} />
                          <span
                            className="truncate font-mono text-[12px]"
                            style={{
                              color: sel ? 'var(--qw-crux)' : 'var(--qw-fg)',
                              fontWeight: sel ? 600 : 500,
                            }}
                          >
                            {target?.name ?? targetId ?? '—'}
                          </span>
                          <span className="flex min-w-0 items-baseline gap-2.5">
                            {target && (
                              <span
                                className="font-mono text-[10.5px] tracking-[0.04em]"
                                style={{ color: 'var(--qw-fg-faint)' }}
                              >
                                {normalizeKind(target.kind)}
                              </span>
                            )}
                            {f.source && (
                              <span
                                className="min-w-0 truncate font-mono text-[11px]"
                                style={{ color: 'var(--qw-fg-muted)' }}
                              >
                                {stripRoot(f.source.file, projectRoot)}:{f.source.line}
                              </span>
                            )}
                          </span>
                          <span className="flex items-center gap-1">
                            {target && (
                              <Btn
                                size="xs"
                                icon={<Icon name="arrowRight" size={11} />}
                                onClick={(ev) => {
                                  ev.stopPropagation()
                                  navigate({ view: 'library-index', promptId: target.id })
                                }}
                                title={`Open ${target.name} in the index`}
                              >
                                Inspect
                              </Btn>
                            )}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )
              })}

              {/* Suppressed footer */}
              <div
                className="flex items-center gap-2.5 rounded-[8px] px-3.5 py-2 font-mono text-[11px]"
                style={{
                  border: '1px dashed var(--qw-border)',
                  color: 'var(--qw-fg-faint)',
                }}
              >
                <Icon name="x" size={11} />
                <span>
                  {suppressedCount} suppressed via{' '}
                  <span style={{ color: 'var(--qw-fg-muted)' }}>// crux-lint-disable</span> · suppressed findings stay
                  out of the inbox but still show on their definition page.
                </span>
              </div>
            </div>

            {/* Right column — sticky detail */}
            {selectedFinding && (
              <DetailPanel
                finding={selectedFinding}
                defsById={defsById}
                projectRoot={projectRoot}
                onNavigate={(id) => navigate({ view: 'library-index', promptId: id })}
              />
            )}
          </div>
        )}
      </div>
    </QwShell>
  )
}

/** Sweep-view detail panel. Renders the backend's authoritative read
 *  model — see `LintBits.tsx` and the field map in the file header.
 *  Section order mirrors the v4 design:
 *    Header → What → Why it matters → Impact → Affected → Evidence →
 *    Suggested fixes → Related → Suppress hint → Actions. */
function DetailPanel({
  finding,
  defsById,
  projectRoot,
  onNavigate,
}: {
  finding: IndexLintFinding
  defsById: Map<string, ProjectDefinition>
  projectRoot: string | undefined
  onNavigate: (id: string) => void
}) {
  const targetId = finding.primaryDefinitionId ?? finding.relatedDefinitionIds?.[0]
  const target = targetId ? defsById.get(targetId) : undefined
  const directive = resolveSuppressDirective(finding)
  const docsHref = resolveDocsHref(finding)

  // Affected scope = backend's `affectedDefinitionIds`, falling back
  // to `relatedDefinitionIds`. The primary target is shown in the
  // header so we exclude it.
  const affectedIds = useMemo(
    () =>
      (finding.affectedDefinitionIds ?? finding.relatedDefinitionIds).filter(
        (id) => id !== finding.primaryDefinitionId,
      ),
    [finding.affectedDefinitionIds, finding.relatedDefinitionIds, finding.primaryDefinitionId],
  )

  // Related = related ∪ propagated, minus the primary target. Used for
  // structural navigation (not impact scope — that's `affectedIds`).
  const related = useMemo(() => {
    const ids = new Set<string>()
    for (const id of finding.relatedDefinitionIds ?? []) ids.add(id)
    for (const id of finding.propagatedDefinitionIds ?? []) ids.add(id)
    if (finding.primaryDefinitionId) ids.delete(finding.primaryDefinitionId)
    return Array.from(ids)
      .map((id) => defsById.get(id))
      .filter((d): d is ProjectDefinition => Boolean(d))
  }, [finding, defsById])

  return (
    <div
      className="self-start overflow-hidden rounded-[10px]"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-crux-line)',
        position: 'sticky',
        top: 0,
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3.5"
        style={{
          background: 'var(--qw-crux-soft)',
          borderBottom: '1px solid var(--qw-border)',
        }}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <LintSeverityChip severity={finding.severity} />
          <span className="text-[14px] font-semibold">{finding.title}</span>
          <LintMetaChips finding={finding} />
        </div>
        {target && (
          <div className="font-mono text-[12px]" style={{ color: 'var(--qw-crux)' }}>
            {target.name}
          </div>
        )}
        {finding.source && (
          <div className="mt-0.5 font-mono text-[11px]" style={{ color: 'var(--qw-fg-faint)' }}>
            {stripRoot(finding.source.file, projectRoot)}:{finding.source.line}
            {target && ` · ${normalizeKind(target.kind)}`}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3.5 px-4 py-3.5">
        {/* What — instance-specific, per-finding message. */}
        <Section eyebrow="What">
          <span style={{ fontFamily: 'var(--qw-serif, Georgia, serif)' }}>{finding.message}</span>
        </Section>

        {/* Why it matters — per-rule rationale. */}
        <Section eyebrow="Why it matters">
          <span style={{ fontFamily: 'var(--qw-serif, Georgia, serif)' }}>{finding.rationale}</span>
        </Section>

        {/* Impact — only when backend ships per-finding impact text. */}
        {finding.impact && (
          <Section eyebrow="Impact">
            <span style={{ fontFamily: 'var(--qw-serif, Georgia, serif)' }}>{finding.impact}</span>
          </Section>
        )}

        {/* Affected scope */}
        {affectedIds.length > 0 && (
          <Section eyebrow={`Affects · ${affectedIds.length}`}>
            <AffectedDefList ids={affectedIds} defsById={defsById} onSelect={onNavigate} max={8} />
          </Section>
        )}

        {/* Evidence */}
        {finding.evidence.length > 0 && (
          <Section eyebrow={`Evidence · ${finding.evidence.length}`}>
            <EvidenceList
              items={finding.evidence}
              defsById={defsById}
              onSelect={onNavigate}
              projectRoot={projectRoot}
            />
          </Section>
        )}

        {/* Suggested fixes */}
        {finding.fixes.length > 0 && (
          <Section eyebrow={`Suggested fix${finding.fixes.length === 1 ? '' : 'es'}`}>
            <div className="flex flex-col gap-2">
              {finding.fixes.map((fix, i) => (
                <FixCard
                  key={`${fix.kind}-${i}`}
                  fix={fix}
                  severity={finding.severity}
                  source={finding.source}
                  projectRoot={projectRoot}
                />
              ))}
            </div>
          </Section>
        )}

        {/* Related defs — structural, separate from impact scope. */}
        {related.length > 0 && (
          <Section eyebrow="Related">
            <div className="flex flex-col gap-1.5">
              {related.map((d) => {
                const g = glyphFor(d.kind)
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => onNavigate(d.id)}
                    className="grid w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover:bg-(--qw-bg-muted)"
                    style={{
                      gridTemplateColumns: '22px minmax(0, 1fr) 12px',
                      background: 'var(--qw-bg)',
                      border: '1px solid var(--qw-border)',
                    }}
                  >
                    <KindBadge name={g.icon} color={g.color} size={18} />
                    <span className="truncate font-mono text-[12px]">{d.name}</span>
                    <Icon name="arrowRight" size={12} color="var(--qw-fg-faint)" />
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        {/* Suppress hint */}
        {directive && (
          <div
            className="font-mono text-[10.5px] leading-[1.55]"
            style={{
              color: 'var(--qw-fg-faint)',
              borderTop: '1px dashed var(--qw-border)',
              paddingTop: 10,
            }}
          >
            Suppress with{' '}
            <code
              className="rounded-[3px] px-1.5 py-[1px] text-[10.5px]"
              style={{
                background: 'var(--qw-bg-muted)',
                color: 'var(--qw-fg)',
                border: '1px solid var(--qw-border)',
              }}
            >
              {directive}
            </code>{' '}
            above the declaration.
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 pt-1">
          {finding.source && (
            <Btn
              size="sm"
              variant="primary"
              icon={<Icon name="link" size={11} />}
              onClick={() => {
                if (finding.source) {
                  window.location.href = `vscode://file${finding.source.file}:${finding.source.line}`
                }
              }}
            >
              Open in editor
            </Btn>
          )}
          {docsHref && (
            <a
              href={docsHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-[4px] border px-2.5 py-[5px] text-[12px] hover:bg-(--qw-bg-muted)"
              style={{ borderColor: 'var(--qw-border)', color: 'var(--qw-fg)' }}
            >
              <Icon name="book" size={11} /> Rule docs
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ eyebrow, children }: { eyebrow: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        className="mb-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        {eyebrow}
      </div>
      <div className="text-[13px] leading-[1.55]" style={{ color: 'var(--qw-fg-muted)' }}>
        {children}
      </div>
    </div>
  )
}
