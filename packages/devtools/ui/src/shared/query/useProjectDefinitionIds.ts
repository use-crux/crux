import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ProjectIndexData } from '@/types'
import { fetchProjectIndex } from '@/shared/services/project-index'
import { qk } from './queryClient'

/** Current compiler-owned definition ids for read-time runtime-ref resolution. */
export function useProjectDefinitionIds(): ReadonlySet<string> | undefined {
  const query = useQuery<ProjectIndexData, Error>({ queryKey: qk.index(), queryFn: ({ signal }) => fetchProjectIndex(signal) })
  return useMemo(
    () => (query.data ? new Set(query.data.definitions.map((definition) => definition.id)) : undefined),
    [query.data],
  )
}
