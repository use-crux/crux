/** Runtime-backed Thread inspector with Memory-style loading and empty states. */

import { SkeletonCard } from "@/shared/components/Skeleton";
import { useThreadInspection } from "../hooks/useThreadInspection";
import { ThreadTopology } from "./ThreadTopology";

export function ThreadInspector({ threadId }: { threadId: string }) {
  const query = useThreadInspection(threadId);
  if (query.isPending) return <SkeletonCard />;
  if (query.error) {
    return (
      <div
        className="rounded-[8px] px-4 py-3 text-[12px]"
        style={{
          background: "var(--devtools-danger-soft)",
          color: "var(--devtools-danger)",
        }}
      >
        Thread topology could not be loaded: {query.error.message}
      </div>
    );
  }
  return query.data ? <ThreadTopology inspection={query.data} /> : null;
}
