import { RunDetailShell } from '@/features/run-detail/components/RunDetailShell'
import type { RunLens } from '@/features/run-detail/types'

interface RunDetailPageProps {
  traceId: string
  lens: RunLens
  spanId?: string
  summary?: boolean
}

export function RunDetailPage(props: RunDetailPageProps) {
  return <RunDetailShell {...props} />
}
