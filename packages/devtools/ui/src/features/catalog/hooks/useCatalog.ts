/**
 * Devtools catalog hook — prompts, contexts, tools registered with
 * `@crux/core`. Backed by `/api/catalog` and refreshed in place by the
 * `catalog` WS event (the WS handler in `useDevtools.ts` calls
 * `queryClient.setQueryData` with the payload, so no extra network
 * round-trip).
 *
 * Used by App.tsx (GlobalSearch index) and Library.tsx.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { qk } from '@/shared/query/queryClient'
import { catalogService, type CatalogData } from '../services/catalog'

export function useCatalog() {
  const q = useQuery<CatalogData, Error>({
    queryKey: qk.catalog(),
    queryFn: ({ signal }) => catalogService.getCatalog(signal),
  })
  return {
    data: q.data,
    /** True once `/api/catalog` (or a WS catalog push) has populated. */
    received: q.data !== undefined,
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  }
}

/**
 * Suspense-enabled catalog hook.
 *
 * Initial load suspends (rely on a surrounding SectionBoundary fallback);
 * background refetches keep the previous catalog visible. Use this in
 * any catalog screen that's already wrapped in a boundary.
 */
export function useCatalogSuspense(): CatalogData {
  return useSuspenseQuery({
    queryKey: qk.catalog(),
    queryFn: ({ signal }) => catalogService.getCatalog(signal),
  }).data
}
