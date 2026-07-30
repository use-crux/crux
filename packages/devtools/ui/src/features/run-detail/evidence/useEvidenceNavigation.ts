/** Batched exact Local navigation for evidence source and producer refs. */

import { useQuery } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { fetchEvidenceNavigation } from "./service";
import type {
  EvidenceApiGraphRef,
  EvidenceApiNavigationResult,
  EvidenceApiSubject,
} from "./types";

/** Resolve public execution subjects without guessing run-versus-span. */
export function useEvidenceNavigation(
  subjects: readonly EvidenceApiSubject[],
) {
  const uniqueSubjects = dedupeSubjects(subjects);
  const refs = uniqueSubjects.flatMap(navigationCandidatesForSubject);
  const query = useQuery({
    queryKey: qk.observability.evidenceNavigation(refs),
    queryFn: ({ signal }) => fetchEvidenceNavigation(refs, signal),
    enabled: refs.length > 0,
  });
  const byRef = new Map(
    (query.data?.results ?? []).map((result) => [
      graphRefKey(result.ref),
      result,
    ]),
  );
  return {
    resultFor(subject: EvidenceApiSubject) {
      const results = navigationCandidatesForSubject(subject)
        .map((ref) => byRef.get(graphRefKey(ref)))
        .filter(
          (result): result is EvidenceApiNavigationResult =>
            result !== undefined,
        );
      return selectResolvedEvidenceNavigation(results);
    },
    loading: query.isPending,
    error: query.error,
  };
}

/** Expand a public execution ref into exact run/span resolver candidates. */
export function navigationCandidatesForSubject(
  subject: EvidenceApiSubject,
): readonly EvidenceApiGraphRef[] {
  switch (subject.kind) {
    case "execution":
      return [
        { kind: "run", id: subject.id },
        { kind: "span", id: subject.id },
      ];
    case "artifact":
      return [{ kind: "artifact", id: subject.id }];
    case "effect.receipt":
      return [{ kind: "effect.receipt", id: subject.id }];
  }
}

/** Require one exact resolution; public execution ambiguity fails closed. */
export function selectResolvedEvidenceNavigation(
  results: readonly EvidenceApiNavigationResult[],
): EvidenceApiNavigationResult | undefined {
  const resolved = results.filter((result) => result.status === "resolved");
  return resolved.length === 1 ? resolved[0] : undefined;
}

function dedupeSubjects(
  subjects: readonly EvidenceApiSubject[],
): readonly EvidenceApiSubject[] {
  return [
    ...new Map(
      subjects.map((subject) => [
        `${subject.kind}\x00${subject.id}`,
        subject,
      ]),
    ).values(),
  ];
}

function graphRefKey(ref: EvidenceApiGraphRef): string {
  return `${ref.kind}\x00${ref.id}`;
}
