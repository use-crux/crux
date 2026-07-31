/** TanStack Query adapter for one live Thread topology resource. */

import { useQuery } from "@tanstack/react-query";
import { qk } from "@/shared/query/queryClient";
import { threadService } from "../services/thread";

export function useThreadInspection(threadId: string) {
  return useQuery({
    queryKey: qk.threads.inspection(threadId),
    queryFn: ({ signal }) => threadService.inspect(threadId, signal),
  });
}
