import { expectOk, fetchJson, postJson } from "@/shared/services/http";
import { fetchProjectIndex } from "@/shared/services/project-index";
import type {
  ProjectIndexData,
  ProjectIndexWatchRunInfo,
  ProjectIndexWatchStatus,
} from "@/types";

export type IndexData = ProjectIndexData;
export type IndexWatchStatus = ProjectIndexWatchStatus;
type IndexWatchStatusPayload = Partial<
  Omit<IndexWatchStatus, "lastRun"> & {
    lastRun?: Partial<ProjectIndexWatchRunInfo>;
  }
>;

export const indexService = {
  async getIndex(signal?: AbortSignal): Promise<IndexData> {
    return fetchProjectIndex(signal);
  },

  /**
   * Trigger a project re-index. The Go service runs the index service
   * method synchronously and also publishes a fresh `index` WS snapshot,
   * so callers only need to invalidate the index query afterwards.
   */
  async reindex(): Promise<void> {
    const res = await postJson("/api/index/reindex", {});
    await expectOk(res, "reindex index");
  },

  /** Return the latest coalesced Project Index watch run telemetry. */
  async getWatchStatus(signal?: AbortSignal): Promise<IndexWatchStatus> {
    const payload = await fetchJson<IndexWatchStatusPayload | null>(
      "/api/project/index/watch",
      signal,
    );
    return normalizeWatchStatus(payload);
  },
};

/**
 * Normalizes the bounded watch-status read model produced by older and newer
 * local runtimes into the strict UI shape used by status components.
 */
export function normalizeWatchStatus(
  payload: IndexWatchStatusPayload | null | undefined,
): IndexWatchStatus {
  const lastRun = payload?.lastRun;
  return {
    state: payload?.state ?? "idle",
    lastRun:
      lastRun == null
        ? undefined
        : {
            runId: lastRun.runId ?? 0,
            status: lastRun.status ?? "unknown",
            planKind: lastRun.planKind,
            fallbackUsed: lastRun.fallbackUsed ?? false,
            fallbackReason: lastRun.fallbackReason,
            graphConfidence: lastRun.graphConfidence,
            changedFileCount: lastRun.changedFileCount ?? 0,
            deletedFileCount: lastRun.deletedFileCount ?? 0,
            affectedFileCount: lastRun.affectedFileCount ?? 0,
            affectedDefinitionCount: lastRun.affectedDefinitionCount ?? 0,
            patchCount: lastRun.patchCount ?? 0,
            deltaBatchCount: lastRun.deltaBatchCount,
            coalescedWhileRunning: lastRun.coalescedWhileRunning,
            pendingRunReplacedCount: lastRun.pendingRunReplacedCount,
            phaseTimingsMs: lastRun.phaseTimingsMs,
            semanticStatus: lastRun.semanticStatus ?? "unknown",
            staleSemanticDropped: lastRun.staleSemanticDropped,
          },
  };
}
