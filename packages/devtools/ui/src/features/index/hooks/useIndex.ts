/**
 * Devtools index hook — prompts, contexts, tools registered with
 * `@crux/core`. Backed by `/api/index` and refreshed in place by the
 * `index` WS event (the WS handler in `useDevtools.ts` calls
 * `queryClient.setQueryData` with the payload, so no extra network
 * round-trip).
 *
 * Used by App.tsx (GlobalSearch index) and Library.tsx.
 */

import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { qk } from '@/shared/query/queryClient'
import { indexService, type IndexData } from '../services/index'

export function useIndex() {
  const q = useQuery<IndexData, Error>({
    queryKey: qk.index(),
    queryFn: ({ signal }) => indexService.getIndex(signal),
  })
  return {
    data: q.data,
    /** True once `/api/index` (or a WS index push) has populated. */
    received: q.data !== undefined,
    loading: q.isPending || q.isFetching,
    error: q.error ?? null,
  }
}

/**
 * Suspense-enabled index hook.
 *
 * Initial load suspends (rely on a surrounding SectionBoundary fallback);
 * background refetches keep the previous index visible. Use this in
 * any index screen that's already wrapped in a boundary.
 */
export function useIndexSuspense(): IndexData {
  return useSuspenseQuery({
    queryKey: qk.index(),
    queryFn: ({ signal }) => indexService.getIndex(signal),
  }).data
}
