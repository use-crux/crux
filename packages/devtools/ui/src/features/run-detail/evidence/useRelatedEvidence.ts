/** Complete Related Evidence query over structural descendants only. */

import { useQuery } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { fetchEvidenceSubjectSummaries } from "./service";
import {
  findStructuralNode,
  projectRelatedEvidence,
  structuralDescendants,
  type EvidenceStructuralNode,
} from "./related-evidence";
import type { EvidenceApiSubject } from "./types";

const LOCAL_SUBJECT_BATCH_LIMIT = 100;

/**
 * Load every descendant chunk before exposing an exact total.
 *
 * @remarks TanStack Query treats any failed chunk as one failed query, so a
 * partial response can never be rendered as an exact “N of M” total.
 */
export function useRelatedEvidence(input: {
  readonly root: EvidenceStructuralNode;
  readonly selectedId: string;
  readonly limit: number;
}) {
  const subjects = relatedEvidenceSubjects(input.root, input.selectedId);
  const query = useQuery({
    queryKey: qk.observability.relatedEvidence(subjects),
    queryFn: ({ signal }) => loadRelatedEvidence(input, signal),
  });
  return {
    result: query.data,
    loading: query.isPending,
    error: query.error,
  };
}

/** Load every Local chunk before projecting one exact Related Evidence total. */
export async function loadRelatedEvidence(
  input: {
    readonly root: EvidenceStructuralNode;
    readonly selectedId: string;
    readonly limit: number;
  },
  signal?: AbortSignal,
  fetcher = fetchEvidenceSubjectSummaries,
) {
  const subjects = relatedEvidenceSubjects(input.root, input.selectedId);
  const responses = await Promise.all(
    chunk(subjects, LOCAL_SUBJECT_BATCH_LIMIT).map((items) =>
      fetcher(items, signal),
    ),
  );
  const counts = new Map<string, number>();
  for (const response of responses) {
    for (const result of response.results) {
      if (
        result.status === "available" &&
        result.totalActiveRecordCount > 0
      ) {
        counts.set(
          `${result.subject.kind}:${result.subject.id}`,
          result.totalActiveRecordCount,
        );
      }
    }
  }
  return projectRelatedEvidence({ ...input, countsBySubject: counts });
}

export function chunk<T>(
  items: readonly T[],
  size: number,
): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function relatedEvidenceSubjects(
  root: EvidenceStructuralNode,
  selectedId: string,
): readonly EvidenceApiSubject[] {
  const selected = findStructuralNode(root, selectedId);
  if (!selected) return [];
  const seen = new Set<string>();
  return structuralDescendants(selected).flatMap((node) => {
    const id = node.spanId ?? node.id;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ kind: "execution" as const, id }];
  });
}
