/**
 * Library group — Index, Memory, Workspaces, Plans.
 *
 * Index is the v2 master–detail browser (`features/index/v2`): a finder
 * rail grouped along six axes + a full-width per-kind detail view, plus an
 * architecture-graph overlay. It is driven entirely by the `/api/index`
 * read model (definitions / relations / metadata.* / sourceRefs / quality /
 * lintFindings), adapted once via `buildIndex`.
 *
 * Memory / Workspaces / Plans are Library v2 screens that wrap themselves in
 * QwShell — this file just forwards the deep-link params from navigation.
 *
 * Lint findings ship in two surfaces:
 *   1. In-context Health section on the def detail page (Index v2).
 *   2. Sweep view at `/library/index/health` (IndexHealth) — the
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
import { useIndexSuspense } from '@/features/index/hooks/useIndex'
import { indexService } from '@/features/index/services/index'
import { useConnected } from '@/app/runtime/runtimeStore'
import { IndexHealth } from './IndexHealth'
import { buildIndex, IndexBrowser, IndexIndexProvider, IndexingStatus } from '../v2'
import { Btn } from '../v2/primitives'
import { MemoryView } from '@/features/memory/components/MemoryView'
import { PlansView } from '@/features/plans/components/PlansView'
import { WorkspacesView } from '@/features/workspaces/components/WorkspacesView'

export function IndexView({
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

  // Re-index runs the index service on the Go side and publishes a fresh
  // `index` WS snapshot; we invalidate afterwards so the query reconciles
  // even if the push is missed.
  const reindex = useMutation({
    mutationFn: () => indexService.reindex(),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.index() })
    },
  })

  // Suspends on first paint — caught by the SectionBoundary below. WS-driven
  // index pushes refresh in the background without re-suspending.
  const projectIndex = useIndexSuspense()
  const definitions = projectIndex.definitions ?? []
  const relations = projectIndex.relations ?? []
  const lintFindings = projectIndex.lintFindings ?? []
  const visibleLintFindings = lintFindings.filter((l) => !l.suppressed)

  // Adapt the read model once; rebuild only when the index payload changes.
  const indexModel = useMemo(() => buildIndex(projectIndex), [projectIndex])

  // Selection: an explicit click wins; otherwise honor a deep-link param if it
  // resolves, else fall back to the first standalone definition.
  const deepLink = promptId ?? contextId ?? toolName
  const [selected, setSelected] = useState<string | null>(null)
  const effectiveSelected =
    selected ?? (deepLink && indexModel.byId(deepLink) ? deepLink : (indexModel.standalone[0]?.id ?? null))
  const [graphOpen, setGraphOpen] = useState(false)

  // Index | Health tab strip — matches the Library sibling screens.
  const indexTabs: QwTab[] = [
    {
      label: 'Index',
      iconName: 'book',
      active: tab !== 'health',
      onClick: () => navigate({ view: 'library-index' }),
    },
    {
      label: 'Health',
      iconName: 'sparkle',
      count: visibleLintFindings.length > 0 ? visibleLintFindings.length : undefined,
      active: tab === 'health',
      onClick: () => navigate({ view: 'library-index', tab: 'health' }),
    },
  ]

  // Roll-up view ("Index · Health") — opted into via `tab: 'health'`.
  if (tab === 'health') {
    return <IndexHealth index={indexModel} indexedAt={projectIndex.indexedAt} connected={connected} tabs={indexTabs} />
  }

  const subtitle = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontFamily: 'var(--qw-mono)', fontSize: 12.5 }}>
        {definitions.length} definition{definitions.length === 1 ? '' : 's'} · {relations.length} relation
        {relations.length === 1 ? '' : 's'}
      </span>
      <IndexingStatus indexing={projectIndex.indexing} />
    </span>
  )

  return (
    <QwShell
      activeView="library-index"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Library / Index"
      title="Index"
      subtitle={subtitle}
      connected={connected}
      noScroll
      tabs={indexTabs}
      actions={
        <>
          <Btn icon="grid" size="sm" onClick={() => setGraphOpen(true)}>
            Graph
          </Btn>
          <Btn
            icon="sparkle"
            size="sm"
            variant="soft"
            onClick={() => navigate({ view: 'library-index', tab: 'health' })}
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
      <SectionBoundary title="Index" invalidateKeys={[qk.index()]} fallback={<SkeletonSplit sidebarRows={14} />}>
        <IndexIndexProvider index={indexModel}>
          <IndexBrowser
            selected={effectiveSelected}
            onSelect={setSelected}
            graphOpen={graphOpen}
            onGraphClose={() => setGraphOpen(false)}
          />
        </IndexIndexProvider>
      </SectionBoundary>
    </QwShell>
  )
}

export function LibraryMemory({ memoryId }: { memoryId?: string }) {
  return <MemoryView memoryId={memoryId} />
}

export function LibraryWorkspaces({ workspaceId, filePath }: { workspaceId?: string; filePath?: string }) {
  return <WorkspacesView workspaceId={workspaceId} filePath={filePath} />
}

export function LibraryPlans({ planId }: { planId?: string }) {
  return <PlansView planId={planId} />
}
