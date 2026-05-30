import { RunDetailView } from '@/features/run-detail/components/RunDetailView'
import type { RunDetailMode } from '@/app/navigation/useNavigation'

interface RunDetailPageProps {
  traceId: string
  mode: RunDetailMode
  spanId?: string
}

export function RunDetailPage(props: RunDetailPageProps) {
  return <RunDetailView {...props} />
}
