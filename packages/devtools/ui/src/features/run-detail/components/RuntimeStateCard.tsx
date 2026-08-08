import type { ObservabilityRunDetailNode } from "@/types";
import { SessionTurnCard } from "./SessionTurnCard";
import { ThreadOperationCard } from "./ThreadOperationCard";
import {
  isTransportEnvelopeDetail,
  TransportEnvelopeCard,
} from "./TransportEnvelopeCard";

export function isRuntimeStateDetail(
  node: ObservabilityRunDetailNode,
): boolean {
  return (
    node.primitive === "thread.operation" ||
    node.primitive === "session.turn" ||
    isTransportEnvelopeDetail(node)
  );
}

export function runtimeStateTitle(node: ObservabilityRunDetailNode): string {
  if (node.primitive === "session.turn") {
    return "Session turn";
  }
  if (isTransportEnvelopeDetail(node)) {
    return "Transport envelope";
  }
  return "Thread operation";
}

export function RuntimeStateCard({
  node,
}: {
  node: ObservabilityRunDetailNode;
}) {
  if (node.primitive === "session.turn") {
    return <SessionTurnCard node={node} />;
  }
  if (isTransportEnvelopeDetail(node)) {
    return <TransportEnvelopeCard node={node} />;
  }
  return <ThreadOperationCard node={node} />;
}
