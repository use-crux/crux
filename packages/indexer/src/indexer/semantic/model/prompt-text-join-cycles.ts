import type { PromptTextFragmentJoinEvidence } from "@use-crux/core/project-index";

interface PromptTextJoinEntry {
  readonly ownerId: string;
  readonly join: PromptTextFragmentJoinEvidence;
}

/**
 * Removes every semantic edge that participates in a named-fragment cycle.
 *
 * Rust independently detects syntax-local cycles while rendering. Persisted
 * semantic evidence remains acyclic so saved joins cannot manufacture a
 * recursive catalogue graph.
 */
export function suppressCyclicPromptTextJoins<
  const Entry extends PromptTextJoinEntry,
>(entries: readonly Entry[]): readonly Entry[] {
  const graph = new Map<string, string[]>();
  for (const { ownerId, join } of entries) {
    const targets = graph.get(ownerId) ?? [];
    targets.push(join.targetSourceRefId);
    graph.set(ownerId, targets);
  }
  return entries.filter(
    ({ ownerId, join }) =>
      !hasPath(graph, join.targetSourceRefId, ownerId, new Set()),
  );
}

function hasPath(
  graph: ReadonlyMap<string, readonly string[]>,
  current: string,
  target: string,
  visited: Set<string>,
): boolean {
  if (current === target) return true;
  if (visited.has(current)) return false;
  visited.add(current);
  return (graph.get(current) ?? []).some((next) =>
    hasPath(graph, next, target, visited),
  );
}
