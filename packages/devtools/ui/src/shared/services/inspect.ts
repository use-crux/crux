import type {
  InspectInsightRecord,
  InspectInsightSilence,
  InspectOverviewRecord,
  InspectRunDetailRecord,
  InspectRunRecord,
  SpanPrimitive,
} from "@/types";
import { fetchJson, fetchJsonOr404 } from "@/shared/services/http";

/** Filters supported by the retained runtime-run inspection read model. */
export interface InspectRunsOptions {
  status?: readonly string[];
  target?: readonly string[];
  kind?: readonly string[];
  model?: readonly string[];
  session?: readonly string[];
  primitive?: readonly SpanPrimitive[];
  since?: number;
  until?: number;
  search?: string;
  sort?: "time" | "duration" | "cost" | "tokens";
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export function buildRunsQuery(opts: InspectRunsOptions | undefined): string {
  if (!opts) return "";
  const params = new URLSearchParams();
  if (opts.status?.length) params.set("status", opts.status.join(","));
  if (opts.target?.length) params.set("target", opts.target.join(","));
  if (opts.kind?.length) params.set("kind", opts.kind.join(","));
  if (opts.model?.length) params.set("model", opts.model.join(","));
  if (opts.session?.length) params.set("session", opts.session.join(","));
  if (opts.primitive?.length) params.set("primitive", opts.primitive.join(","));
  if (opts.since != null) params.set("since", String(opts.since));
  if (opts.until != null) params.set("until", String(opts.until));
  if (opts.search) params.set("search", opts.search);
  if (opts.sort) params.set("sort", opts.sort);
  if (opts.order) params.set("order", opts.order);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Read-only service for the retained Inspect surfaces. */
export const inspectService = {
  overview: (window?: string, signal?: AbortSignal) =>
    fetchJson<InspectOverviewRecord>(
      `/api/inspect/overview${
        window && window !== "all"
          ? `?window=${encodeURIComponent(window)}`
          : ""
      }`,
      signal,
    ),
  runs: (opts?: InspectRunsOptions, signal?: AbortSignal) =>
    fetchJson<readonly InspectRunRecord[]>(
      `/api/inspect/runs${buildRunsQuery(opts)}`,
      signal,
    ),
  runDetail: (traceId: string, signal?: AbortSignal) =>
    fetchJsonOr404<InspectRunDetailRecord>(
      `/api/inspect/runs/${encodeURIComponent(traceId)}`,
      signal,
    ),
  insights: (signal?: AbortSignal) =>
    fetchJson<readonly InspectInsightRecord[]>("/api/inspect/insights", signal),
  insightSilences: (includeDeleted: boolean, signal?: AbortSignal) =>
    fetchJson<readonly InspectInsightSilence[]>(
      `/api/inspect/insights/silences${
        includeDeleted ? "?include=deleted" : ""
      }`,
      signal,
    ),
};
