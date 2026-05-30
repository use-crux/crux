import { RunsView } from '@/features/runs/components/RunsView'
import type { RunsFilters } from '@/features/runs/components/RunsFilterBar'

interface RunsPageProps {
  groupBy: 'none' | 'primitive' | 'session' | 'target'
  filters: RunsFilters
}

export function RunsPage(props: RunsPageProps) {
  return <RunsView {...props} />
}
