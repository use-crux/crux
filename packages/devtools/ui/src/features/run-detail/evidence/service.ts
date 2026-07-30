/** HTTP and page-composition boundary for canonical Local evidence inspection. */

import type { EvidenceRole } from "@use-crux/core/evidence";
import { apiUrl } from "@/shared/services/http";
import type {
  EvidenceApiInspectRequest,
  EvidenceApiInspectResult,
  EvidenceApiGraphRef,
  EvidenceApiNavigationResponse,
  EvidenceApiRoleResult,
  EvidenceApiRoles,
  EvidenceApiSubject,
  EvidenceApiSubjectSummaryResponse,
} from "./types";

/** Bounded error returned by the Local evidence inspection endpoint. */
export class EvidenceInspectionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Evidence inspection failed (${code}).`);
    this.name = "EvidenceInspectionError";
  }
}

/** Fetch one role-scoped canonical evidence page. */
export async function fetchEvidenceInspection(
  request: EvidenceApiInspectRequest,
  signal?: AbortSignal,
): Promise<EvidenceApiInspectResult> {
  const response = await fetch(
    apiUrl("/api/observability/evidence/inspect"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    throw new EvidenceInspectionError(
      typeof body?.code === "string" ? body.code : "EVIDENCE_QUERY_FAILED",
      response.status,
    );
  }
  return (await response.json()) as EvidenceApiInspectResult;
}

/** Fetch positional complete counts for at most 100 authorized subjects. */
export function fetchEvidenceSubjectSummaries(
  subjects: readonly EvidenceApiSubject[],
  signal?: AbortSignal,
): Promise<EvidenceApiSubjectSummaryResponse> {
  return postEvidenceBatch(
    "/api/observability/evidence/subjects/summary",
    { subjects },
    signal,
  );
}

/** Resolve at most 100 exact canonical graph references positionally. */
export function fetchEvidenceNavigation(
  refs: readonly EvidenceApiGraphRef[],
  signal?: AbortSignal,
): Promise<EvidenceApiNavigationResponse> {
  return postEvidenceBatch(
    "/api/observability/evidence/navigation/resolve",
    { refs },
    signal,
  );
}

async function postEvidenceBatch<TResponse>(
  path: string,
  body: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<TResponse> {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    throw new EvidenceInspectionError(
      typeof payload?.code === "string"
        ? payload.code
        : "EVIDENCE_QUERY_FAILED",
      response.status,
    );
  }
  return (await response.json()) as TResponse;
}

/**
 * Merge cursor pages without letting later page summaries replace the first
 * page's complete snapshot aggregates.
 */
export function mergeEvidencePages(
  pages: readonly EvidenceApiInspectResult[],
  selectedRole: EvidenceRole,
): EvidenceApiInspectResult | undefined {
  const first = pages[0];
  if (!first) return undefined;
  const role = mergeSelectedRole(pages, selectedRole);
  return Object.freeze({
    subject: first.subject,
    roles: Object.freeze({
      ...first.roles,
      [selectedRole]: role,
    }) as EvidenceApiRoles,
  });
}

function mergeSelectedRole<R extends EvidenceRole>(
  pages: readonly EvidenceApiInspectResult[],
  role: R,
): EvidenceApiRoleResult<R> {
  const first = pages[0]!.roles[role] as EvidenceApiRoleResult<R>;
  const last = pages.at(-1)!.roles[role] as EvidenceApiRoleResult<R>;
  return Object.freeze({
    ...first,
    records: Object.freeze(
      pages.flatMap(
        (page) =>
          (page.roles[role] as EvidenceApiRoleResult<R>).records,
      ),
    ),
    ...(first.history
      ? {
          history: Object.freeze(
            pages.flatMap(
              (page) =>
                (page.roles[role] as EvidenceApiRoleResult<R>).history ?? [],
            ),
          ),
        }
      : {}),
    truncated: last.truncated,
    ...(last.cursor ? { cursor: last.cursor } : { cursor: undefined }),
  });
}
