/**
 * Library group — Catalog, Memory, Workspaces, Plans.
 *
 * Catalog is the v2 master–detail browser (`features/catalog/v2`): a finder
 * rail grouped along six axes + a full-width per-kind detail view, plus an
 * architecture-graph overlay. It is driven entirely by the `/api/catalog`
 * read model (definitions / relations / metadata.* / sourceRefs / quality /
 * lintFindings), adapted once via `buildIndex`.
 *
 * Memory / Workspaces / Plans are Library v2 screens that wrap themselves in
 * QwShell — this file just forwards the deep-link params from navigation.
 *
 * Lint findings ship in two surfaces:
 *   1. In-context Health section on the def detail page (Catalog v2).
 *   2. Sweep view at `/library/catalog/health` (CatalogHealth) — the
 *      "clean up the project" view, grouped by ruleId. Both read the same
 *      backend payload; there is no client-side derivation of findings.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { QwShell, type QwTab } from '@/qw/shell/QwShell'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonSplit } from '@/shared/components/Skeleton'
import { qk } from '@/shared/query/queryClient'
import { navTarget } from '@/app/navigation/navTarget'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useCatalogSuspense } from '@/features/catalog/hooks/useCatalog'
import { catalogService } from '@/features/catalog/services/catalog'
import { useConnected } from '@/app/runtime/runtimeStore'
import { CatalogHealth } from './CatalogHealth'
import { buildIndex, CatalogBrowser, CatalogIndexProvider, IndexingStatus } from '../v2'
import { Btn } from '../v2/primitives'
import { MemoryView } from '@/features/memory/components/MemoryView'
import { PlansView } from '@/features/plans/components/PlansView'
import { WorkspacesView } from '@/features/workspaces/components/WorkspacesView'

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
  const { navigate } = useNavigation()
  const connected = useConnected()
  const queryClient = useQueryClient()

  // Re-index runs the catalog service on the Go side and publishes a fresh
  // `catalog` WS snapshot; we invalidate afterwards so the query reconciles
  // even if the push is missed.
  const reindex = useMutation({
    mutationFn: () => catalogService.reindex(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.catalog() })
    },
  })

  // Suspends on first paint — caught by the SectionBoundary below. WS-driven
  // catalog pushes refresh in the background without re-suspending.
  const catalog = useCatalogSuspense()
  const definitions = catalog.definitions ?? []
  const relations = catalog.relations ?? []
  const lintFindings = catalog.lintFindings ?? []
  const visibleLintFindings = lintFindings.filter((l) => !l.suppressed)
  const suppressedCount = lintFindings.length - visibleLintFindings.length

  // Adapt the read model once; rebuild only when the catalog payload changes.
  const index = useMemo(() => buildIndex(catalog), [catalog])

  // Selection: an explicit click wins; otherwise honor a deep-link param if it
  // resolves, else fall back to the first standalone definition.
  const deepLink = promptId ?? contextId ?? toolName
  const [selected, setSelected] = useState<string | null>(null)
  const effectiveSelected =
    selected ?? (deepLink && index.byId(deepLink) ? deepLink : (index.standalone[0]?.id ?? null))
  const [graphOpen, setGraphOpen] = useState(false)

  // Catalog | Health tab strip — matches the Library sibling screens.
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
        indexedAt={catalog.indexedAt}
        projectRoot={catalog.project?.root}
        connected={connected}
        tabs={catalogTabs}
      />
    )
  }

  const subtitle = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: 'var(--qw-mono)', fontSize: 12.5 }}>
        {definitions.length} definition{definitions.length === 1 ? '' : 's'} · {relations.length} relation
        {relations.length === 1 ? '' : 's'}
      </span>
      <IndexingStatus indexing={catalog.indexing} />
    </span>
  )

  return (
    <QwShell
      activeView="library-catalog"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Catalog"
      title="Catalog"
      subtitle={subtitle}
      connected={connected}
      noScroll
      tabs={catalogTabs}
      actions={
        <>
          <Btn icon="grid" size="sm" onClick={() => setGraphOpen(true)}>
            Graph
          </Btn>
          <Btn
            icon="sparkle"
            size="sm"
            variant="soft"
            onClick={() => navigate({ view: 'library-catalog', tab: 'health' })}
          >
            Health · {visibleLintFindings.length}
          </Btn>
          <Btn
            icon="loop"
            size="sm"
            title="Re-index the project"
            disabled={reindex.isPending}
            onClick={() => reindex.mutate()}
          >
            {reindex.isPending ? 'Re-indexing…' : 'Re-index'}
          </Btn>
        </>
      }
    >
      <SectionBoundary
        title="Catalog"
        invalidateKeys={[qk.catalog()]}
        fallback={<SkeletonSplit sidebarRows={14} />}
      >
        <CatalogIndexProvider index={index}>
          <CatalogBrowser
            selected={effectiveSelected}
            onSelect={setSelected}
            graphOpen={graphOpen}
            onGraphClose={() => setGraphOpen(false)}
          />
        </CatalogIndexProvider>
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
