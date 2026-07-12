import { useQuery } from '@tanstack/react-query'
import type { ObservabilityDefinitionActivitySummary } from '@/types'
import { fetchDefinitionActivity } from '@/shared/services/definition-activity'
import { qk } from './queryClient'

/** Shared Catalog-facing query for one definition's runtime rollup. */
export function useDefinitionActivity(definitionId: string | undefined): {
  activity: ObservabilityDefinitionActivitySummary | undefined
  loading: boolean
  error: Error | null
} {
  const query = useQuery<ObservabilityDefinitionActivitySummary, Error>({
    queryKey: qk.observability.definitionActivity(definitionId),
    queryFn: ({ signal }) => fetchDefinitionActivity(definitionId ?? '', signal),
    enabled: Boolean(definitionId),
  })
  return { activity: query.data, loading: query.isPending || query.isFetching, error: query.error ?? null }
}
