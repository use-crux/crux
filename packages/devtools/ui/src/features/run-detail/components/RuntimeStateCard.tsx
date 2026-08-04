import type { ObservabilityRunDetailNode } from "@/types";
import { SessionTurnCard } from "./SessionTurnCard";
import { ThreadOperationCard } from "./ThreadOperationCard";

export function isRuntimeStateDetail(
  node: ObservabilityRunDetailNode,
): boolean {
  return (
    node.primitive === "thread.operation" || node.primitive === "session.turn"
  );
}

export function runtimeStateTitle(node: ObservabilityRunDetailNode): string {
  return node.primitive === "session.turn"
    ? "Session turn"
    : "Thread operation";
}

export function RuntimeStateCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  return node.primitive === "session.turn" ? (
    <SessionTurnCard node={node} />
  ) : (
    <ThreadOperationCard node={node} />
  );
}
