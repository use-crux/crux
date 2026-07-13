/**
 * Bridge ObservabilityRunDetailNode trees into the pure media run projection.
 *
 * Live Runs pass the complete run-detail graph (`detail.root`) plus the exact
 * selected media span identity so lineage can include relation-connected
 * ingest/index/retrieval nodes outside the media subtree.
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
 * Project a selected media span from a full (or partial) run-detail tree into
 * the Runs media view model.
 *
 * @param root - Complete run-detail graph root (or a mounted media subtree).
 * @param selectedMediaSpanId - Exact media span identity (`spanId` preferred).
 */
export function projectMediaRunFromNode(
  root: ObservabilityRunDetailNode,
  selectedMediaSpanId: string,
  options: Readonly<{ exportMode?: boolean; catalogJoinId?: string }> = {},
): MediaRunView | undefined {
  return projectMediaRunView(flattenNodeGraph(root), {
    ...options,
    selectedSpanId: selectedMediaSpanId,
  });
}

function flattenNodeGraph(
  root: ObservabilityRunDetailNode,
): readonly GraphLikeRecord[] {
  const records: GraphLikeRecord[] = [];
  const walk = (
    node: ObservabilityRunDetailNode,
    parentSpanId: string | null,
  ): void => {
    const spanId = typeof node.spanId === "string" ? node.spanId : node.id;
    const attributes = {
      ...(node.attributes ?? {}),
      ...(typeof node.provider === "string" ? { provider: node.provider } : {}),
      ...(typeof node.model === "string" ? { model: node.model } : {}),
    };
    records.push({
      type: "span:start",
      spanId,
      parentSpanId,
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
    for (const child of node.children ?? []) walk(child, spanId);
  };
  // Prefer recorded parent identity on the root when present; tree walk then
  // rewrites every child parentSpanId to the parent's canonical spanId.
  const rootParent =
    typeof root.parentId === "string" && root.parentId.length > 0
      ? root.parentId
      : null;
  walk(root, rootParent);
  return records;
}
