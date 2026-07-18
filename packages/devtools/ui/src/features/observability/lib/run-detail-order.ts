export interface SequencedRunDetailChild {
  id: string;
  seq?: number;
  startedAt?: string;
  timing?: {
    startedAt?: string;
  };
}

/**
 * Order sibling run-detail nodes for waterfall rendering.
 *
 * The local server already returns children in canonical graph order. When a
 * future/present projection includes `seq`, use it to disambiguate same-ms
 * siblings while preserving backend order for older payloads.
 */
export function orderRunDetailChildren<T extends SequencedRunDetailChild>(
  children: readonly T[],
): readonly T[] {
  return children
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const aTime = startedAtMs(a.node);
      const bTime = startedAtMs(b.node);
      if (aTime !== bTime) return aTime - bTime;
      if (
        a.node.seq != null &&
        b.node.seq != null &&
        a.node.seq !== b.node.seq
      ) {
        return a.node.seq - b.node.seq;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.node);
}

function startedAtMs(node: SequencedRunDetailChild): number {
  const value = node.timing?.startedAt ?? node.startedAt;
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
