import type { ObservabilityRunDetailNode } from "@/types";
import {
  findArtifact,
  findAttribute,
  inspectionOf,
} from "./span-detail-inspection";

export interface RetrievalEntries {
  query?: string;
  /** retrieval mode (`search` or `custom`). */
  mode?: string;
  /** fusion strategy (e.g. `rrf`). */
  fusion?: string;
  rrfK?: number;
  searchLegs?: string[];
  searchCandidates?: Record<string, number>;
  /** number of hits returned after the pipeline. */
  returned?: number;
  /** requested top-k limit. */
  limit?: number;
  hits: Array<Record<string, unknown>>;
  stages: Array<Record<string, unknown>>;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}
function asStringArray(v: unknown): string[] | undefined {
  return Array.isArray(v) && v.every((entry) => typeof entry === "string")
    ? v
    : undefined;
}
function asNumberRecord(v: unknown): Record<string, number> | undefined {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const entries = Object.entries(v);
  return entries.every(([, entry]) => typeof entry === "number")
    ? Object.fromEntries(entries)
    : undefined;
}

export function retrievalEntries(
  node: ObservabilityRunDetailNode,
): RetrievalEntries {
  const attrQuery = asString(findAttribute(node, "query"));
  const attrStages = findAttribute(node, "stages");
  const attrStagesArr = Array.isArray(attrStages)
    ? (attrStages as Array<Record<string, unknown>>)
    : [];

  // Prefer the typed `retrieval.hits` preview (CruxRetrievalHitsPreview): it
  // carries query/mode/search metadata/limit/returned + hits[] + stages[] in one place.
  const hitsArt = findArtifact(node, "retrieval.hits")?.preview;
  if (hitsArt && typeof hitsArt === "object" && !Array.isArray(hitsArt)) {
    const p = hitsArt as {
      query?: unknown;
      mode?: unknown;
      fusion?: unknown;
      rrfK?: unknown;
      searchLegs?: unknown;
      searchCandidates?: unknown;
      limit?: unknown;
      returned?: unknown;
      hits?: unknown;
      stages?: unknown;
    };
    const hits = Array.isArray(p.hits)
      ? (p.hits as Array<Record<string, unknown>>)
      : [];
    const stages = Array.isArray(p.stages)
      ? (p.stages as Array<Record<string, unknown>>)
      : attrStagesArr;
    return {
      query: asString(p.query) ?? attrQuery,
      mode: asString(p.mode),
      fusion: asString(p.fusion),
      rrfK: asNumber(p.rrfK),
      searchLegs: asStringArray(p.searchLegs),
      searchCandidates: asNumberRecord(p.searchCandidates),
      returned: asNumber(p.returned) ?? hits.length,
      limit: asNumber(p.limit),
      hits,
      stages,
    };
  }

  // Curated inspection.retrieval section (backend-curated rows).
  const insp = inspectionOf(node);
  if (insp?.retrieval && insp.retrieval.length > 0) {
    const hits: Array<Record<string, unknown>> = [];
    for (const item of insp.retrieval) {
      const data = item.data;
      if (data == null) continue;
      if (Array.isArray(data)) {
        hits.push(...(data as Array<Record<string, unknown>>));
      } else if (typeof data === "object") {
        const obj = data as { hits?: unknown };
        if (Array.isArray(obj.hits))
          hits.push(...(obj.hits as Array<Record<string, unknown>>));
        else hits.push(data as Record<string, unknown>);
      }
    }
    return {
      query: attrQuery,
      hits,
      stages: attrStagesArr,
      returned: hits.length,
    };
  }

  // Legacy fallbacks: bare array artifact / attribute.
  const hits = Array.isArray(hitsArt)
    ? (hitsArt as Array<Record<string, unknown>>)
    : Array.isArray(findAttribute(node, "hits"))
      ? (findAttribute(node, "hits") as Array<Record<string, unknown>>)
      : [];
  return {
    query: attrQuery,
    hits,
    stages: attrStagesArr,
    returned: hits.length,
  };
}
