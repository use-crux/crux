/**
 * Runs list — local execution traces enriched into QualityRun records.
 *
 * Top tabs: All / Live / Failures / Has feedback. Filter chip bar with
 * a `Group by` toggle (none / session / target). Compact 30px rows.
 * Sessions live here as a grouping option (industry convention from
 * LangSmith/Braintrust/Langfuse), not a separate top-level screen.
 */

import { useEffect, useMemo, useState } from 'react'
import { QwShell } from '@/qw/shell/QwShell'
import { Btn } from '@/qw/shell/primitives'
import { Icon } from '@/qw/shell/Icon'
import { navTarget } from '@/app/navigation/navTarget'
import { useToast } from '@/qw/shell/useToast'
import { useNavigation } from '@/app/navigation/useNavigation'
import { useDeleteRunsMutation } from '@/shared/hooks/useQualityMutations'
import { useConnected } from '@/app/runtime/runtimeStore'
import { RunsFilterBar } from './RunsFilterBar'
import { GroupByDropdown } from '@/qw/shell/FilterPopover'
import { QwTooltip } from '@/qw/shell/QwTooltip'
import { ColumnsButton } from './ColumnsButton'
import { BulkActionsBar } from './BulkActionsBar'
import { RunsTable } from './RunsTable'
import { SectionBoundary } from '@/qw/shell/SectionBoundary'
import { SkeletonRows } from '@/shared/components/Skeleton'
import { useRuns } from '../hooks/useRuns'
import { useRunSelection } from '../hooks/useRunSelection'
import type { ColumnId, RunsFilters, RunsProps, RunsTab } from '../types'
import { gridTemplateFor, loadVisibleColumns, saveVisibleColumns } from '../lib/run-columns'
import { countRuns, exportableRunRows, groupRuns, rowsForTab } from '../lib/run-groups'

export function RunsView({ groupBy, filters }: RunsProps) {
  const { navigate } = useNavigation()
  const connected = useConnected()
  const { toast } = useToast()
  const { allRows, distinctTargets, distinctModels, loading: runsLoading, isFilterPending } = useRuns(filters)
  const initialLoading = runsLoading && allRows.length === 0
  const [visibleColumns, setVisibleColumns] = useState<readonly ColumnId[]>(() => loadVisibleColumns())
  useEffect(() => {
    saveVisibleColumns(visibleColumns)
  }, [visibleColumns])
  const gridTemplate = useMemo(() => gridTemplateFor(visibleColumns), [visibleColumns])
  const visibleSet = useMemo(() => new Set(visibleColumns), [visibleColumns])

  const deleteRuns = useDeleteRunsMutation()
  const [deleting, setDeleting] = useState(false)
  const [tab, setTab] = useState<RunsTab>('all')
  const rows = useMemo(() => rowsForTab(allRows, tab), [allRows, tab])
  const groups = useMemo(() => groupRuns(rows, groupBy), [rows, groupBy])
  const counts = useMemo(() => countRuns(allRows), [allRows])
  const selection = useRunSelection(allRows, rows)

  async function deleteSelected() {
    const ids = Array.from(selection.selected)
    if (ids.length === 0) return
    const ok = window.confirm(
      ids.length === 1
        ? `Delete this run? This removes its observability records. This cannot be undone.`
        : `Delete ${ids.length} runs? This removes their observability records. This cannot be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    const result = await deleteRuns(ids)
    setDeleting(false)
    if (result.ok) selection.clearSelection()
  }

  // Push a filter change up into the URL so the runs page is shareable.
  function updateFilters(next: RunsFilters) {
    navigate({ view: 'runs', groupBy, ...next })
  }

  return (
    <QwShell
      activeView="runs"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Inspect / Runs"
      title="Runs"
      subtitle={`${counts.total.toLocaleString()} in window${counts.live > 0 ? ' · live' : ''}`}
      connected={connected}
      actions={
        <>
          <QwTooltip content="Multi-select + suite picker · coming soon">
            <Btn
              icon={<Icon name="layers" size={13} />}
              onClick={() =>
                toast({
                  kind: 'info',
                  title: 'Bulk save to suite',
                  message: 'Multi-select + dataset picker is next — for now open a run and use "Save as case".',
                })
              }
            >
              Save to suite
            </Btn>
          </QwTooltip>
          <QwTooltip content="Runs are captured automatically when your app calls generate() / stream()">
            <Btn
              variant="primary"
              icon={<Icon name="play" size={13} />}
              onClick={() =>
                toast({
                  kind: 'info',
                  title: 'Trigger a run',
                  message: 'Runs are captured automatically when your app calls generate()/stream().',
                })
              }
            >
              New run
            </Btn>
          </QwTooltip>
        </>
      }
      tabs={[
        { label: 'All', active: tab === 'all', count: counts.total, onClick: () => setTab('all') },
        { label: 'Live', active: tab === 'live', count: counts.live, onClick: () => setTab('live') },
        { label: 'Failures', active: tab === 'failures', count: counts.failures, onClick: () => setTab('failures') },
        {
          label: 'Has feedback',
          active: tab === 'has-feedback',
          count: counts.feedback,
          onClick: () => setTab('has-feedback'),
        },
      ]}
      filterBar={
        <RunsFilterBar
          filters={filters}
          onChange={updateFilters}
          distinctTargets={distinctTargets}
          distinctModels={distinctModels}
          right={
            <>
              <GroupByDropdown
                value={groupBy}
                options={[
                  { value: 'none', label: 'No grouping' },
                  { value: 'primitive', label: 'Kind (agent / flow / …)' },
                  { value: 'target', label: 'Target' },
                  { value: 'session', label: 'Session' },
                ]}
                onChange={(next) => navigate({ view: 'runs', groupBy: next, ...filters })}
              />
              <ColumnsButton visible={visibleColumns} onChange={setVisibleColumns} />
              <QwTooltip content="Download the currently-filtered rows as JSON">
                <Btn
                  size="xs"
                  icon={<Icon name="arrowDown" size={12} />}
                  onClick={() => {
                    const data = exportableRunRows(rows)
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `runs-${Date.now()}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    toast({ kind: 'ok', title: 'Exported', message: `${data.length} runs to .json` })
                  }}
                >
                  export
                </Btn>
              </QwTooltip>
            </>
          }
        />
      }
    >
      <div>
        {filters.definitionId && (
          <div className="flex items-center gap-2 border-b border-(--qw-border) px-4 py-2 text-[11.5px]" style={{ color: 'var(--qw-fg-muted)' }}>
            <Icon name="link" size={12} color="var(--qw-fg-faint)" />
            <span>
              Filtered to definition <span className="font-mono" style={{ color: 'var(--qw-fg)' }}>{filters.definitionId}</span>
            </span>
            <Btn
              size="xs"
              variant="soft"
              onClick={() => updateFilters({ ...filters, definitionId: undefined })}
            >
              Clear
            </Btn>
          </div>
        )}
        {selection.selected.size > 0 && (
          <BulkActionsBar
            count={selection.selected.size}
            busy={deleting}
            onCancel={selection.clearSelection}
            onDelete={deleteSelected}
          />
        )}
        <SectionBoundary
          title="Runs table"
          fallback={
            <div className="p-4">
              <SkeletonRows rows={10} rowHeight={30} />
            </div>
          }
        >
          {initialLoading ? (
            <div className="p-4">
              <SkeletonRows rows={10} rowHeight={30} />
            </div>
          ) : (
            <div className="transition-opacity" style={{ opacity: isFilterPending ? 0.6 : 1 }}>
              <RunsTable
                groups={groups}
                ungrouped={groupBy === 'none'}
                gridTemplate={gridTemplate}
                visibleSet={visibleSet}
                selected={selection.selected}
                selectionState={selection.visibleSelectionState}
                onToggleAllVisible={selection.toggleAllVisible}
                onToggleSelected={selection.toggleSelected}
                onOpenRun={(traceId) => navigate({ view: 'run-detail', traceId })}
              />
            </div>
          )}
        </SectionBoundary>
      </div>
    </QwShell>
  )
}
