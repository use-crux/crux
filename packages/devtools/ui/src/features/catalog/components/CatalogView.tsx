/**
 * Library group — Catalog, Memory, Workspaces, Plans.
 *
 * Catalog stays here (the prompts/contexts/tools/evals browser is
 * driven by /api/catalog.definitions and renders inline below).
 *
 * Memory / Workspaces / Plans are Library v2 screens that wrap
 * themselves in QwShell — Library.tsx just forwards the deep-link
 * params from the navigation state.
 *
 * Lint findings ship in two surfaces, per the v4 design:
 *   1. In-context Suggestions section on the def detail page (Catalog).
 *   2. Sweep view at `/library/catalog/health` (CatalogHealth) — the
 *      "I want to clean up the project" view, grouped by ruleId. The
 *      catalog header carries a quiet `Health · N` button that routes
 *      into it; both surfaces read the same backend payload so there is
 *      no client-side derivation of findings.
 */

import { useState, type ReactNode } from 'react'
import { QwShell, type QwTab } from '@/qw/shell/QwShell'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonSplit } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import {
  QwMenuRoot,
  QwMenuTrigger,
  QwMenuContent,
  QwMenuLabel,
} from '@/qw/shell/QwMenu'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/shared/components/ui/dropdown-menu'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useCatalog, useCatalogSuspense } from '@/features/catalog/hooks/useCatalog'
import { useConnected, useJudgeEvents } from '@/app/runtime/runtimeStore'
import {
  Catalog,
  CATALOG_KIND_OPTIONS,
  type CatalogGroupBy,
} from './Catalog'
import { CatalogHealth } from './CatalogHealth'
import type { ProjectCatalogIndexingStatus } from '@/types'
import { MemoryView } from '@/features/memory/components/MemoryView'
import { PlansView } from '@/features/plans/components/PlansView'
import { WorkspacesView } from '@/features/workspaces/components/WorkspacesView'

function fmtIndexedAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const sameDay = new Date().toDateString() === d.toDateString()
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const GROUP_BY_OPTIONS: ReadonlyArray<{ value: CatalogGroupBy; label: string }> = [
  { value: 'module', label: 'Module' },
  { value: 'file', label: 'File' },
]

/** Page-header dropdown — matches the design's `Btn icon="filter">All kinds`
 *  pattern. Trigger button shows the active value; menu uses a radio
 *  group so the selection state is clear. Used for both the kind filter
 *  and the group-by selector. */
function HeaderDropdown<V extends string>({
  iconName,
  label,
  active,
  value,
  options,
  onChange,
}: {
  iconName: Parameters<typeof Icon>[0]['name']
  label: string
  active: boolean
  value: V
  options: ReadonlyArray<{ value: V; label: string }>
  onChange: (next: V) => void
}) {
  const cur = options.find((o) => o.value === value)
  return (
    <QwMenuRoot>
      <QwMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-[28px] items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] transition-colors hover:opacity-90"
          style={{
            border: '1px solid var(--qw-border)',
            background: active ? 'var(--qw-crux-soft)' : 'var(--qw-bg-elev)',
            color: active ? 'var(--qw-crux)' : 'var(--qw-fg)',
            boxShadow: active ? 'inset 0 0 0 1px var(--qw-crux-line)' : 'none',
            fontWeight: active ? 600 : 500,
          }}
        >
          <Icon
            name={iconName}
            size={11}
            color={active ? 'var(--qw-crux)' : 'var(--qw-fg-muted)'}
          />
          {cur?.label ?? value}
          <Icon
            name="arrowDown"
            size={10}
            color={active ? 'var(--qw-crux)' : 'var(--qw-fg-faint)'}
          />
        </button>
      </QwMenuTrigger>
      <QwMenuContent align="end">
        <QwMenuLabel>{label}</QwMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as V)}>
          {options.map((o) => (
            <DropdownMenuRadioItem
              key={o.value}
              value={o.value}
              className="qw-menu-radio"
              style={{
                color: 'var(--qw-fg)',
                fontFamily: 'var(--qw-mono)',
                fontSize: 11.5,
                padding: '6px 10px',
                paddingLeft: 28,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </QwMenuContent>
    </QwMenuRoot>
  )
}

/** A single tonal status chip — same quiet, mono treatment as the
 *  suggestions pill. Used to surface catalog indexing phase state. */
function StatusPill({ label, tone }: { label: string; tone: 'warn' | 'iris' | 'muted' }) {
  const fg =
    tone === 'warn'
      ? 'var(--qw-warn)'
      : tone === 'iris'
        ? 'var(--qw-iris)'
        : 'var(--qw-fg-muted)'
  const bg =
    tone === 'warn'
      ? 'var(--qw-warn-soft)'
      : tone === 'iris'
        ? 'var(--qw-iris-soft)'
        : 'var(--qw-bg-muted)'
  return (
    <span
      className="inline-flex items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[12px]"
      style={{
        color: fg,
        background: bg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${fg} 30%, transparent)`,
      }}
    >
      {label}
    </span>
  )
}

/** Translate the backend's `catalog.indexing` read model into the quiet
 *  status chips the header should surface. Returns nothing when both the
 *  top-level and semantic passes are `ready` — a healthy catalog only
 *  shows its indexed timestamp.
 *
 *  The cases mirror the read-model handoff:
 *   - semantic pending/running  → "semantic indexing…" (enrichment in flight)
 *   - semantic degraded         → "semantic degraded"
 *   - semantic disabled         → "semantic off"
 *   - status degraded (semantic ready) → "degraded" — e.g. an older binary
 *     still reporting `catalog.static_only`; restart `crux dev`.
 *   - status refreshing/cold    → "refreshing…" */
function indexingPills(
  indexing: ProjectCatalogIndexingStatus | undefined,
): ReadonlyArray<{ label: string; tone: 'warn' | 'iris' | 'muted' }> {
  if (!indexing) return []
  const pills: Array<{ label: string; tone: 'warn' | 'iris' | 'muted' }> = []
  const sem = indexing.semantic?.status
  if (sem === 'pending' || sem === 'running') {
    pills.push({ label: 'semantic indexing…', tone: 'iris' })
  } else if (sem === 'degraded') {
    pills.push({ label: 'semantic degraded', tone: 'warn' })
  } else if (sem === 'disabled') {
    pills.push({ label: 'semantic off', tone: 'muted' })
  } else if (indexing.status === 'degraded') {
    // Semantic is ready but the catalog is still flagged degraded — the
    // classic stale-binary signal from the handoff.
    pills.push({ label: 'degraded', tone: 'warn' })
  } else if (indexing.status === 'refreshing' || indexing.status === 'cold') {
    pills.push({ label: 'refreshing…', tone: 'iris' })
  }
  return pills
}

/** Small `N suggestions` chip — warn-toned per design when there are
 *  warnings present, iris when only info findings exist. Quiet by design. */
function SuggestionsPill({ count, hasWarnings }: { count: number; hasWarnings: boolean }) {
  if (count === 0) return null
  const fg = hasWarnings ? 'var(--qw-warn)' : 'var(--qw-iris)'
  const bg = hasWarnings ? 'var(--qw-warn-soft)' : 'var(--qw-iris-soft)'
  return (
    <span
      className="inline-flex items-center rounded-[3px] px-1.5 py-[1px] font-mono text-[12px]"
      style={{
        color: fg,
        background: bg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${fg} 30%, transparent)`,
      }}
    >
      {count} suggestion{count === 1 ? '' : 's'}
    </span>
  )
}

export function CatalogView({
  promptId,
  contextId,
  toolName,
  tab,
}: {
  promptId?: string
  contextId?: string
  toolName?: string
  tab?: string
}) {
  void promptId
  void contextId
  void toolName
  const { navigate } = useNavigation()
  const connected = useConnected()
  void useJudgeEvents // legacy: judgeEvents are no longer surfaced in catalog
  // Suspends on first paint — caught by the SectionBoundary below.
  // WS-driven catalog pushes refresh in the background without
  // re-suspending (TanStack Query semantics for useSuspenseQuery).
  const catalog = useCatalogSuspense()
  // Defensive defaults: the service normalizes these to `[]`, but a WS
  // `catalog` push that lands before the WS handler's normalization
  // (or a backend that hasn't yet shipped a given field) would otherwise
  // crash with "Cannot read properties of undefined". Cheap to keep.
  const definitions = catalog.definitions ?? []
  const relations = catalog.relations ?? []
  const diagnostics = catalog.diagnostics ?? []
  const lintFindings = catalog.lintFindings ?? []
  const visibleLintFindings = lintFindings.filter((l) => !l.suppressed)
  const suppressedCount = lintFindings.length - visibleLintFindings.length
  const hasWarnings = visibleLintFindings.some(
    (l) => l.severity === 'warning' || l.severity === 'error',
  )
  const indexedAt = catalog.indexedAt

  // Lifted from the inner `Catalog` so the page header can host the
  // dropdowns that drive these controls. `groupBy` persists across
  // sessions (matches the previous inline-toggle behavior); `kindFilter`
  // does not — it's a per-visit lens.
  const [groupBy, setGroupBy] = useState<CatalogGroupBy>(() => {
    try {
      const stored = localStorage.getItem('crux.catalog.groupBy')
      return stored === 'file' ? 'file' : 'module'
    } catch {
      return 'module'
    }
  })
  const [kindFilter, setKindFilter] = useState<string>('all')

  function setAndPersistGroupBy(v: CatalogGroupBy) {
    setGroupBy(v)
    try {
      localStorage.setItem('crux.catalog.groupBy', v)
    } catch {
      // ignore (private browsing, etc.)
    }
  }

  // Both the default catalog view and the Health sweep view share the
  // same tab strip — matches the v4 sweep-view design [Catalog | Health].
  // Diagnostics could become a third tab later if/when a sweep view for
  // it ships; today diagnostics render inline on the def detail page.
  const catalogTabs: QwTab[] = [
    {
      label: 'Catalog',
      iconName: 'book',
      active: tab !== 'health',
      onClick: () => navigate({ view: 'library-catalog' }),
    },
    {
      label: 'Health',
      iconName: 'sparkle',
      count: visibleLintFindings.length > 0 ? visibleLintFindings.length : undefined,
      active: tab === 'health',
      onClick: () => navigate({ view: 'library-catalog', tab: 'health' }),
    },
  ]

  // Sweep view ("Catalog · Health") — opted into via `tab: 'health'`.
  if (tab === 'health') {
    return (
      <CatalogHealth
        definitions={definitions}
        lintFindings={lintFindings}
        suppressedCount={suppressedCount}
        indexedAt={indexedAt}
        projectRoot={catalog.project?.root}
        connected={connected}
        tabs={catalogTabs}
      />
    )
  }

  // Default (in-context) view: build a subtitle that includes a
  // warn-toned chip-style suggestions count, then the catalog header
  // carries a `Health · N` button that routes into the sweep view.
  const subtitleParts: ReactNode[] = []
  if (definitions.length > 0) {
    subtitleParts.push(`${definitions.length} definition${definitions.length === 1 ? '' : 's'}`)
    if (relations.length > 0)
      subtitleParts.push(` · ${relations.length} relation${relations.length === 1 ? '' : 's'}`)
    if (diagnostics.length > 0)
      subtitleParts.push(
        ` · ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`,
      )
    if (visibleLintFindings.length > 0) {
      subtitleParts.push(' · ')
      subtitleParts.push(
        <SuggestionsPill
          key="pill"
          count={visibleLintFindings.length}
          hasWarnings={hasWarnings}
        />,
      )
    }
    for (const pill of indexingPills(catalog.indexing)) {
      subtitleParts.push(' · ')
      subtitleParts.push(<StatusPill key={`idx-${pill.label}`} label={pill.label} tone={pill.tone} />)
    }
    if (indexedAt) subtitleParts.push(` · indexed ${fmtIndexedAt(indexedAt)}`)
  } else {
    subtitleParts.push('Authored prompts, contexts, tools & evals')
  }

  return (
    <QwShell
      activeView="library-catalog"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Catalog"
      title="Catalog"
      subtitle={<span className="inline-flex items-center gap-1">{subtitleParts}</span>}
      connected={connected}
      noScroll
      tabs={catalogTabs}
      actions={
        <>
          <HeaderDropdown
            iconName="filter"
            label="Filter by kind"
            active={kindFilter !== 'all'}
            value={kindFilter}
            options={CATALOG_KIND_OPTIONS}
            onChange={setKindFilter}
          />
          <HeaderDropdown
            iconName="layers"
            label="Group by"
            active={false}
            value={groupBy}
            options={GROUP_BY_OPTIONS}
            onChange={setAndPersistGroupBy}
          />
        </>
      }
    >
      <SectionBoundary
        title="Catalog"
        invalidateKeys={[qk.catalog()]}
        fallback={<SkeletonSplit sidebarRows={14} />}
      >
        <Catalog
          definitions={definitions}
          relations={relations}
          diagnostics={diagnostics}
          lintFindings={lintFindings}
          projectRoot={catalog.project?.root}
          groupBy={groupBy}
          kindFilter={kindFilter}
        />
      </SectionBoundary>
    </QwShell>
  )
}

export function LibraryMemory({ memoryId }: { memoryId?: string }) {
  return <MemoryView memoryId={memoryId} />
}

export function LibraryWorkspaces({
  workspaceId,
  filePath,
}: {
  workspaceId?: string
  filePath?: string
}) {
  return <WorkspacesView workspaceId={workspaceId} filePath={filePath} />
}

export function LibraryPlans({ planId }: { planId?: string }) {
  return <PlansView planId={planId} />
}
