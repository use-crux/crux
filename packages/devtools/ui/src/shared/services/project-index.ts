import type { ProjectIndexData } from "@/types";
import { fetchJson } from "./http";
import { assertPromptTextProjectIndexEvidence } from "./project-index/evidence";

/** Fetch and normalize the shared Project Index snapshot. */
export async function fetchProjectIndex(
  signal?: AbortSignal,
): Promise<ProjectIndexData> {
  const payload = await fetchJson<Partial<ProjectIndexData> | null>(
    "/api/index",
    signal,
  );
  assertPromptTextProjectIndexEvidence(payload ?? {});
  return {
    projectRoot: payload?.projectRoot,
    serverVersion: payload?.serverVersion,
    generation: payload?.generation,
    schemaVersion: payload?.schemaVersion ?? 1,
    prompts: payload?.prompts ?? [],
    contexts: payload?.contexts ?? [],
    tools: payload?.tools ?? [],
    project: payload?.project,
    indexedAt: payload?.indexedAt,
    indexing: payload?.indexing,
    definitions: payload?.definitions ?? [],
    relations: payload?.relations ?? [],
    diagnostics: payload?.diagnostics ?? [],
    lintFindings: payload?.lintFindings ?? [],
    sources: payload?.sources ?? [],
  };
}
