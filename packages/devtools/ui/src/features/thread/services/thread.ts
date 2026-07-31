/** Runtime Bridge reads for payload-safe Thread topology. */

import { fetchJson } from "@/shared/services/http";
import type { ThreadInspection } from "@/types";

function threadResourceId(threadId: string): string {
  return `thread:${encodeURIComponent(threadId)}`;
}

export const threadService = {
  inspect: (threadId: string, signal?: AbortSignal) => {
    const resourceId = threadResourceId(threadId);
    return fetchJson<ThreadInspection>(
      `/api/resources/${encodeURIComponent(resourceId)}`,
      signal,
    );
  },
};
