import type {
  ObservabilityResourceActivity,
  ObservabilityRunDetail,
  ObservabilityRunsDelta,
  ObservabilityRunsPage,
  ObservabilityRunsPageOptions,
  ObservabilitySpanEventSummary,
} from "@/types";
import { fetchJson, fetchJsonOr404 } from "@/shared/services/http";

export interface ObservabilitySpanEventsOptions {
  /** Restrict the lazy event read to one event name, for example `token.chunk`. */
  name?: string;
  /** Return only events after this server-provided cursor or timestamp. */
  after?: string;
  /** Maximum number of span events to fetch. The server applies its own cap. */
  limit?: number;
}

export const observabilityService = {
  getRun(
    runId: string,
    signal?: AbortSignal,
  ): Promise<ObservabilityRunDetail | null> {
    return fetchJsonOr404<ObservabilityRunDetail>(
      `/api/observability/runs/${encodeURIComponent(runId)}`,
      signal,
    );
  },

  /**
   * The one joined, revisioned Runs read model (binding spec 04 §3). Filters
   * execute server-side, in SQL, before pagination — the single list source for
   * the Runs page and Global Search (no bare-array list client).
   */
  listRunsPage(
    options: ObservabilityRunsPageOptions = {},
    signal?: AbortSignal,
  ): Promise<ObservabilityRunsPage> {
    return fetchJson<ObservabilityRunsPage>(
      `/api/observability/runs/page${runsPageQuery(options)}`,
      signal,
    );
  },

  /** Bounded reconnect catch-up: runs changed strictly after `sinceRevision`. */
  listRunsDelta(
    sinceRevision: number,
    signal?: AbortSignal,
  ): Promise<ObservabilityRunsDelta> {
    return fetchJson<ObservabilityRunsDelta>(
      `/api/observability/runs/delta?since=${sinceRevision}`,
      signal,
    );
  },

  /**
   * Fetch lazily stored events for a single span.
   *
   * Run detail deliberately omits high-volume stream payloads such as
   * `token.chunk`; focused panes call this endpoint only for the selected span.
   */
  getSpanEvents(
    runId: string,
    spanId: string,
    options: ObservabilitySpanEventsOptions = {},
    signal?: AbortSignal,
  ): Promise<ObservabilitySpanEventSummary[]> {
    return fetchJson<ObservabilitySpanEventSummary[]>(
      `/api/observability/runs/${encodeURIComponent(runId)}/spans/${encodeURIComponent(spanId)}/events${spanEventsQuery(options)}`,
      signal,
    );
  },

  getResourceActivity(
    family: string,
    signal?: AbortSignal,
  ): Promise<ObservabilityResourceActivity[]> {
    return fetchJson<ObservabilityResourceActivity[]>(
      `/api/observability/resources/${encodeURIComponent(family)}`,
      signal,
    );
  },
};

function runsPageQuery(options: ObservabilityRunsPageOptions): string {
  const params = new URLSearchParams();
  if (options.status && options.status.length > 0)
    params.set("status", options.status.join(","));
  if (options.sessionId) params.set("sessionId", options.sessionId);
  if (options.since) params.set("since", options.since);
  if (options.until) params.set("until", options.until);
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.definitionId) params.set("definitionId", options.definitionId);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function spanEventsQuery(options: ObservabilitySpanEventsOptions): string {
  const params = new URLSearchParams();
  if (options.name) params.set("name", options.name);
  if (options.after) params.set("after", options.after);
  if (options.limit != null) params.set("limit", String(options.limit));
  const query = params.toString();
  return query ? `?${query}` : "";
}
