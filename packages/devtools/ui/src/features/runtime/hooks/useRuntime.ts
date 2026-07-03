import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient, qk } from '@/shared/query/queryClient'
import { runtimeService } from '../services/runtime'

export function useRuntimeStatus() {
  return useQuery({
    queryKey: qk.runtime.status(),
    queryFn: ({ signal }) => runtimeService.status(signal),
    refetchInterval: 3_000,
  })
}

export function useRuntimeInspect(workId: string | null | undefined) {
  return useQuery({
    queryKey: qk.runtime.work(workId),
    queryFn: ({ signal }) => runtimeService.inspect(workId!, signal),
    enabled: Boolean(workId),
  })
}

export function useRetryRuntimeWork() {
  return useMutation({
    mutationFn: (workId: string) => runtimeService.retry(workId),
    onSuccess: async (_result, workId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.runtime.status() }),
        queryClient.invalidateQueries({ queryKey: qk.runtime.work(workId) }),
      ])
    },
  })
}

export function useCancelRuntimeWork() {
  return useMutation({
    mutationFn: (workId: string) => runtimeService.cancel(workId),
    onSuccess: async (_result, workId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.runtime.status() }),
        queryClient.invalidateQueries({ queryKey: qk.runtime.work(workId) }),
      ])
    },
  })
}
