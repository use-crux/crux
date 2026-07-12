/**
 * Bridge ObservabilityRunDetailNode trees into the pure media run projection.
 *
 * @module
 */

import type { ObservabilityRunDetailNode } from "@/types";
import {
  projectMediaRunView,
  type GraphLikeRecord,
  type MediaRunView,
} from "./media-run-projection";

/**
 * Project a selected media span (and its descendants/relations/artifacts) into
 * the Runs media view model.
 */
export function projectMediaRunFromNode(
  node: ObservabilityRunDetailNode,
  options: Readonly<{ exportMode?: boolean; catalogJoinId?: string }> = {},
): MediaRunView | undefined {
  if (!node.primitive?.startsWith("media.")) return undefined;
  return projectMediaRunView(flattenNodeGraph(node), options);
}

function flattenNodeGraph(
  root: ObservabilityRunDetailNode,
): readonly GraphLikeRecord[] {
  const records: GraphLikeRecord[] = [];
  const walk = (node: ObservabilityRunDetailNode): void => {
    const spanId = typeof node.spanId === "string" ? node.spanId : node.id;
    const attributes = {
      ...(node.attributes ?? {}),
      ...(typeof node.provider === "string" ? { provider: node.provider } : {}),
      ...(typeof node.model === "string" ? { model: node.model } : {}),
    };
    records.push({
      type: "span:start",
      spanId,
      parentSpanId: node.parentId || null,
      primitive: node.primitive,
      name: node.name ?? node.display?.label ?? node.primitive,
      attributes,
      provider: node.provider,
      model: node.model,
    });
    records.push({
      type: "span:end",
      spanId,
      status: node.status,
      durationMs: node.timing?.durationMs,
      attributes,
    });
    for (const artifact of node.artifacts ?? []) {
      records.push({
        type: "artifact",
        kind: artifact.kind,
        artifactId: artifact.artifactId,
        spanId: artifact.spanId || spanId,
        preview: artifact.preview,
        attributes: artifact.attributes ?? undefined,
      });
    }
    for (const relation of node.relations ?? []) {
      const fromId =
        typeof relation.from === "object" && relation.from && "id" in relation.from
          ? String(relation.from.id)
          : undefined;
      const toId =
        typeof relation.to === "object" && relation.to && "id" in relation.to
          ? String(relation.to.id)
          : undefined;
      records.push({
        type: "edge",
        edgeType: relation.edgeType,
        from: fromId ? { id: fromId } : undefined,
        to: toId ? { id: toId } : undefined,
        attributes: relation.attributes ?? undefined,
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return records;
}
