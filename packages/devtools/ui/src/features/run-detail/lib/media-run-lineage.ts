/**
 * Pure lineage projection for multimodal Runs: nodes, edges, page/time.
 *
 * Reuses canonical observability edge/artifact shapes. Never retains locators,
 * filenames, source IDs, refs, or raw media in the view model.
 *
 * Scope is the relation-connected component around the selected media span:
 * parent identities (ancestors + media descendants) and recorded edge endpoints.
 * Disconnected branches are excluded.
 *
 * @module
 */

import {
  attributionFromArtifact,
  attributionFromRetrievalHits,
  attributionFromUnknown,
} from "./media-run-attribution";
import type {
  GraphLikeRecord,
  MediaLineageEdge,
  MediaLineageNode,
  MediaLineageNodeKind,
} from "./media-run-projection-types";

export {
  formatMediaAttribution,
  attributionFromUnknown,
} from "./media-run-attribution";

export function projectMediaLineage(
  records: readonly GraphLikeRecord[],
  mediaSpanId: string,
  mediaPrimitive: string,
  options: Readonly<{ catalogDefinitionId?: string }> = {},
): Readonly<{
  nodes: readonly MediaLineageNode[];
  edges: readonly MediaLineageEdge[];
}> {
  const connected = collectConnectedIds(records, mediaSpanId);
  const nodesById = new Map<string, MediaLineageNode>();

  const pushNode = (node: MediaLineageNode): void => {
    if (!connected.has(node.id) && node.kind !== "catalog") return;
    const existing = nodesById.get(node.id);
    if (!existing) {
      nodesById.set(node.id, node);
      return;
    }
    if (!existing.attribution && node.attribution) {
      nodesById.set(
        node.id,
        Object.freeze({ ...existing, attribution: node.attribution }),
      );
    }
  };

  pushNode(
    Object.freeze({
      id: mediaSpanId,
      kind: "operation",
      label: mediaPrimitive,
    }),
  );

  for (const start of records) {
    if (
      start.type !== "span:start" ||
      typeof start.spanId !== "string" ||
      typeof start.primitive !== "string" ||
      start.spanId === mediaSpanId ||
      !connected.has(start.spanId)
    ) {
      continue;
    }
    const kind = lineageKindForPrimitive(start.primitive);
    if (!kind) continue;
    pushNode(
      Object.freeze({
        id: start.spanId,
        kind,
        label: start.primitive,
      }),
    );
  }

  for (const artifact of records) {
    if (artifact.type !== "artifact") continue;
    if (artifact.artifactId && !connected.has(artifact.artifactId)) continue;
    projectArtifactNode(artifact, pushNode, nodesById);
  }

  if (options.catalogDefinitionId) {
    pushNode(
      Object.freeze({
        // Internal graph endpoint only — panel renders kind/label, not this id.
        id: options.catalogDefinitionId,
        kind: "catalog",
        label: "catalog",
      }),
    );
  }

  const edges = Object.freeze(
    records
      .filter((record) => record.type === "edge")
      .flatMap((edge): MediaLineageEdge[] => {
        const from = edge.from?.id;
        const to = edge.to?.id;
        if (!from || !to || !edge.edgeType) return [];
        if (!connected.has(from) || !connected.has(to)) return [];
        const attribution = attributionFromUnknown(edge.attributes);
        return [
          Object.freeze({
            from,
            to,
            type: edge.edgeType,
            ...(attribution ? { attribution } : {}),
          }),
        ];
      }),
  );

  return Object.freeze({
    nodes: Object.freeze([...nodesById.values()]),
    edges,
  });
}

/**
 * Relation-connected ids around a media span using parent identities and edges.
 * Ancestors + media descendants seed the set; recorded edges expand it.
 * Sibling branches under a shared parent are not included without an edge.
 */
export function collectConnectedIds(
  records: readonly GraphLikeRecord[],
  mediaSpanId: string,
): ReadonlySet<string> {
  const parentBySpan = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();
  const artifactsBySpan = new Map<string, string[]>();
  const adjacency = new Map<string, Set<string>>();

  const link = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const record of records) {
    if (record.type === "span:start" && typeof record.spanId === "string") {
      if (typeof record.parentSpanId === "string" && record.parentSpanId) {
        parentBySpan.set(record.spanId, record.parentSpanId);
        const list = childrenByParent.get(record.parentSpanId) ?? [];
        list.push(record.spanId);
        childrenByParent.set(record.parentSpanId, list);
      }
    } else if (
      record.type === "artifact" &&
      typeof record.artifactId === "string" &&
      typeof record.spanId === "string"
    ) {
      const list = artifactsBySpan.get(record.spanId) ?? [];
      list.push(record.artifactId);
      artifactsBySpan.set(record.spanId, list);
      link(record.spanId, record.artifactId);
    } else if (record.type === "edge" && record.from?.id && record.to?.id) {
      link(record.from.id, record.to.id);
    }
  }

  const seed = new Set<string>([mediaSpanId]);
  let cursor: string | undefined = mediaSpanId;
  while (cursor) {
    const parent = parentBySpan.get(cursor);
    if (!parent || seed.has(parent)) break;
    seed.add(parent);
    cursor = parent;
  }
  const descQueue = [mediaSpanId];
  while (descQueue.length > 0) {
    const current = descQueue.shift()!;
    for (const child of childrenByParent.get(current) ?? []) {
      if (seed.has(child)) continue;
      seed.add(child);
      descQueue.push(child);
    }
  }
  for (const id of [...seed]) {
    for (const artifactId of artifactsBySpan.get(id) ?? [])
      seed.add(artifactId);
  }

  const connected = new Set<string>(seed);
  const edgeQueue = [...seed];
  while (edgeQueue.length > 0) {
    const current = edgeQueue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (connected.has(next)) continue;
      connected.add(next);
      edgeQueue.push(next);
      for (const artifactId of artifactsBySpan.get(next) ?? []) {
        if (!connected.has(artifactId)) {
          connected.add(artifactId);
          edgeQueue.push(artifactId);
        }
      }
    }
  }
  return connected;
}

function projectArtifactNode(
  artifact: GraphLikeRecord,
  pushNode: (node: MediaLineageNode) => void,
  nodesById: Map<string, MediaLineageNode>,
): void {
  if (!artifact.artifactId) return;

  if (artifact.kind === "input" || artifact.kind === "output") {
    const attribution = attributionFromArtifact(artifact);
    pushNode(
      Object.freeze({
        id: artifact.artifactId,
        kind: artifact.kind,
        label: artifact.kind,
        ...(attribution ? { attribution } : {}),
      }),
    );
    return;
  }

  if (artifact.kind === "media.report") {
    pushNode(
      Object.freeze({
        id: artifact.artifactId,
        kind: "report",
        label: "media.report",
      }),
    );
    return;
  }

  if (artifact.kind === "retrieval.hits") {
    const attribution = attributionFromRetrievalHits(artifact.preview);
    const spanId =
      typeof artifact.spanId === "string" ? artifact.spanId : undefined;
    if (spanId && nodesById.has(spanId) && attribution) {
      const existing = nodesById.get(spanId)!;
      if (!existing.attribution) {
        nodesById.set(spanId, Object.freeze({ ...existing, attribution }));
      }
    }
    pushNode(
      Object.freeze({
        id: artifact.artifactId,
        kind: "retrieval",
        label: "retrieval.hits",
        ...(attribution ? { attribution } : {}),
      }),
    );
    return;
  }

  if (artifact.kind === "ingest.report") {
    pushNode(
      Object.freeze({
        id: artifact.artifactId,
        kind: "ingest",
        label: "ingest.report",
      }),
    );
    return;
  }

  if (artifact.kind === "indexing.report") {
    pushNode(
      Object.freeze({
        id: artifact.artifactId,
        kind: "index",
        label: "indexing.report",
      }),
    );
  }
}

function lineageKindForPrimitive(
  primitive: string,
): MediaLineageNodeKind | undefined {
  if (primitive.startsWith("ingest.")) return "ingest";
  if (primitive.startsWith("indexing.")) return "index";
  if (primitive.startsWith("retrieval.")) return "retrieval";
  return undefined;
}
