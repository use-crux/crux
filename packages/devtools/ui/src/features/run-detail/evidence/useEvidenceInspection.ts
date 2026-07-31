/** Infinite role-scoped query over Local's canonical evidence inspector. */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { EvidenceRole } from "@use-crux/core/evidence";
import { qk } from "@/shared/query/queryClient";
import { fetchEvidenceInspection, mergeEvidencePages } from "./service";
import type { EvidenceApiSubject } from "./types";

const PAGE_LIMIT = 10;

/** Load one selected role while preserving complete summaries for all roles. */
export function useEvidenceInspection(
  subject: EvidenceApiSubject,
  role: EvidenceRole,
) {
  const query = useInfiniteQuery({
    queryKey: qk.observability.evidence(subject, role),
    queryFn: ({ pageParam, signal }) =>
      fetchEvidenceInspection(
        {
          subject,
          role,
          limit: PAGE_LIMIT,
          ...(pageParam ? { cursor: pageParam } : {}),
          includeHistory: true,
          includeData: true,
        },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.roles[role].cursor,
  });

  return {
    result: mergeEvidencePages(query.data?.pages ?? [], role),
    loading: query.isPending,
    fetchingMore: query.isFetchingNextPage,
    error: query.error,
    loadOlder: query.fetchNextPage,
    hasOlder: query.hasNextPage,
  };
}

/** Load aggregate-only role summaries for the constant Inspector rail. */
export function useEvidenceSummary(subject: EvidenceApiSubject) {
  const query = useQuery({
    queryKey: qk.observability.evidence(subject, "summary"),
    queryFn: ({ signal }) =>
      fetchEvidenceInspection(
        {
          subject,
          limit: 1,
          includeHistory: false,
          includeData: false,
        },
        signal,
      ),
  });
  return {
    result: query.data,
    loading: query.isPending,
    error: query.error,
  };
}
