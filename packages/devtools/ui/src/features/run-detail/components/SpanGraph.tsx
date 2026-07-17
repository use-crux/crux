/**
 * ReactFlow-based canvas view of a run's presentation tree.
 *
 * Companion to <SpanTree>: same data (a `SpanNode` root), same selection
 * behavior, but laid out as a horizontal directed graph with one node
 * per span colored by primitive kind and edges as parent→child.
 *
 * Layout strategy: simple depth-by-x, sibling-stack-by-y. Good enough
 * for trees up to a few hundred spans; we don't need a full Sugiyama
 * pass for that. ReactFlow handles pan + zoom + minimap, so navigating
 * a large run still works fine even with naive coordinates.
 */

import { useMemo, useCallback, useEffect, useRef, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import { primitiveAccentVar } from "@/features/run-detail/lib/families";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 56;
const X_GAP = 60;
const Y_GAP = 18;

// Coarse kind → family accent, used only as a fallback when a node has no
// `primitive` (the canonical `primitiveAccentVar` owns the primitive case).
const KIND_ACCENT: Record<string, string> = {
  session: "var(--qw-iris)",
  flow: "var(--qw-crux)",
  composition: "var(--qw-crux)",
  step: "var(--qw-crux)",
  handoff: "var(--qw-fg-faint)",
  trace: "var(--qw-crux)",
};

const STATUS_BG: Record<string, string> = {
  success: "var(--qw-bg-elev)",
  running: "var(--qw-crux-soft)",
  error: "var(--qw-danger-soft)",
  stale: "var(--qw-warn-soft)",
};

const STATUS_DOT: Record<string, string> = {
  success: "var(--qw-ok)",
  running: "var(--qw-crux)",
  error: "var(--qw-danger)",
  stale: "var(--qw-warn)",
};

function accentFor(node: SpanNode): string {
  // Canonical family accent off the full primitive; fall back to the coarse
  // kind map only when the node carries no primitive string.
  if (node.primitive) return primitiveAccentVar(node.primitive);
  return KIND_ACCENT[node.kind] ?? "var(--qw-fg-muted)";
}

function isHandoffish(node: SpanNode): boolean {
  const p = node.primitive ?? "";
  return (
    node.kind === "handoff" ||
    p.startsWith("handoff") ||
    p.startsWith("delegate") ||
    Boolean(node.delegate)
  );
}

/**
 * Edge styling by the relationship the child represents (design Graph
 * vocabulary): handoff / delegate edges read as dashed iris arrows; all
 * other structural parent→child edges stay a quiet neutral line.
 */
function edgeStyleFor(child: SpanNode): { stroke: string; dash?: string } {
  if (isHandoffish(child)) return { stroke: "var(--qw-iris)", dash: "5 4" };
  return { stroke: "var(--qw-border-strong, var(--qw-border))" };
}

interface ShapeSummary {
  spans: number;
  agents: number;
  handoffs: number;
  tools: number;
  generations: number;
  composites: number;
}

/** Walk the span tree once to derive the run-shape header chip counts. */
function summarizeShape(root: SpanNode): ShapeSummary {
  const s: ShapeSummary = {
    spans: 0,
    agents: 0,
    handoffs: 0,
    tools: 0,
    generations: 0,
    composites: 0,
  };
  const walk = (n: SpanNode) => {
    s.spans++;
    const p = n.primitive ?? "";
    if (p.startsWith("agent")) s.agents++;
    else if (isHandoffish(n)) s.handoffs++;
    else if (p.startsWith("tool")) s.tools++;
    else if (p.startsWith("generation")) s.generations++;
    if (n.kind === "composition" || p.startsWith("composition")) s.composites++;
    for (const c of n.children) walk(c);
  };
  walk(root);
  return s;
}

/** Build the "N agents · M handoffs · K spans" chip label from the counts. */
function shapeChipLabel(s: ShapeSummary): string {
  const parts: string[] = [];
  if (s.composites > 0)
    parts.push(`${s.composites} composite${s.composites === 1 ? "" : "s"}`);
  if (s.agents > 0) parts.push(`${s.agents} agent${s.agents === 1 ? "" : "s"}`);
  if (s.handoffs > 0)
    parts.push(`${s.handoffs} handoff${s.handoffs === 1 ? "" : "s"}`);
  if (s.tools > 0) parts.push(`${s.tools} tool${s.tools === 1 ? "" : "s"}`);
  parts.push(`${s.spans} span${s.spans === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

interface SpanNodeData extends Record<string, unknown> {
  label: string;
  primitive: string;
  durationMs?: number;
  status: SpanNode["status"];
  selected: boolean;
  accent: string;
  /** This span's turn explanation carries a warning signal — render a badge. */
  warning?: boolean;
}

const SpanNodeView = memo(function SpanNodeView({
  data,
}: NodeProps<Node<SpanNodeData>>) {
  const bg = data.selected
    ? "var(--qw-crux-soft)"
    : (STATUS_BG[data.status] ?? "var(--qw-bg-elev)");
  const kindLabel = (data.primitive || "").split(".")[0] || data.primitive;
  // Outline is a subtle, status-aware ring (design `GraphNode`) — the kind
  // accent lives in the KindTag chip, not a colored left border.
  const ring = data.selected
    ? "var(--qw-crux)"
    : data.status === "error"
      ? "var(--qw-danger)"
      : data.status === "stale"
        ? "var(--qw-warn)"
        : "var(--qw-border)";
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: bg,
        borderRadius: 9,
        padding: "8px 11px",
        boxShadow: data.selected
          ? "0 0 0 1.5px var(--qw-crux), 0 8px 24px var(--qw-crux-glow, var(--qw-crux-soft))"
          : `inset 0 0 0 1px ${ring}`,
        fontFamily: "var(--qw-mono)",
        fontSize: 11,
        color: "var(--qw-fg)",
        overflow: "hidden",
        cursor: "pointer",
      }}
      title={`${data.primitive} · ${data.label}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: 0 }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 4,
        }}
      >
        {/* Boxed kind tag (design `KindTag`). */}
        <span
          style={{
            color: data.accent,
            background: "var(--qw-bg)",
            boxShadow: `inset 0 0 0 1px ${data.accent}`,
            fontSize: 8.5,
            lineHeight: 1.5,
            padding: "1px 5px",
            borderRadius: 3,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            flexShrink: 0,
            maxWidth: 110,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {kindLabel}
        </span>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 99,
            flexShrink: 0,
            background: STATUS_DOT[data.status] ?? "var(--qw-fg-faint)",
          }}
        />
        <span style={{ flex: 1 }} />
        {data.warning && (
          <span
            style={{ color: "var(--qw-warn)", fontSize: 10, flexShrink: 0 }}
            title="Turn explanation has a warning signal — open Explain"
          >
            ✦
          </span>
        )}
        <span
          style={{ color: "var(--qw-fg-faint)", fontSize: 10, flexShrink: 0 }}
        >
          {fmtDuration(data.durationMs)}
        </span>
      </div>
      <div
        style={{
          color: "var(--qw-fg)",
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {data.label}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: 0 }}
      />
    </div>
  );
});

const nodeTypes = { span: SpanNodeView };

/** A single line + label in the graph's typed-edge legend. */
function LegendEdge({
  label,
  color,
  dash,
}: {
  label: string;
  color: string;
  dash?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="20" height="8" aria-hidden>
        <line
          x1="0"
          y1="4"
          x2="20"
          y2="4"
          stroke={color}
          strokeWidth="1.6"
          strokeDasharray={dash}
        />
      </svg>
      {label}
    </span>
  );
}

/**
 * Build ReactFlow nodes + edges by recursing the SpanNode tree.
 * Each level of depth shifts x by (NODE_WIDTH + X_GAP), siblings stack
 * by y inside their parent's vertical band.
 */
function buildLayout(
  root: SpanNode,
  selectedId: string | null,
  warningSpanIds?: ReadonlySet<string>,
): { nodes: Node<SpanNodeData>[]; edges: Edge[]; height: number } {
  const nodes: Node<SpanNodeData>[] = [];
  const edges: Edge[] = [];

  function leafCount(n: SpanNode): number {
    if (!n.children || n.children.length === 0) return 1;
    return n.children.reduce((sum, c) => sum + leafCount(c), 0);
  }

  function place(n: SpanNode, depth: number, yTop: number): number {
    const leaves = leafCount(n);
    const span = leaves * NODE_HEIGHT + (leaves - 1) * Y_GAP;
    const y = yTop + span / 2 - NODE_HEIGHT / 2;
    const x = depth * (NODE_WIDTH + X_GAP);
    const isSelected = n.id === selectedId;
    nodes.push({
      id: n.id,
      type: "span",
      position: { x, y },
      data: {
        label: n.label || n.primitive || n.id,
        primitive: n.primitive ?? n.kind,
        durationMs: n.durationMs,
        status: n.status,
        selected: isSelected,
        accent: accentFor(n),
        warning: warningSpanIds?.has(n.id) ?? false,
      },
      draggable: false,
      selectable: true,
    });
    let cursor = yTop;
    for (const c of n.children ?? []) {
      const childLeaves = leafCount(c);
      const childSpan = childLeaves * NODE_HEIGHT + (childLeaves - 1) * Y_GAP;
      const es = edgeStyleFor(c);
      edges.push({
        id: `${n.id}->${c.id}`,
        source: n.id,
        target: c.id,
        type: "smoothstep",
        style: {
          stroke: es.stroke,
          strokeWidth: 1.4,
          strokeDasharray: es.dash,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: es.stroke,
          width: 14,
          height: 14,
        },
      });
      place(c, depth + 1, cursor);
      cursor += childSpan + Y_GAP;
    }
    return span;
  }

  const totalHeight = place(root, 0, 0);
  return { nodes, edges, height: totalHeight };
}

export interface SpanGraphProps {
  root: SpanNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Span ids whose turn explanation carries a warning signal — badge them. */
  warningSpanIds?: ReadonlySet<string>;
}

export function SpanGraph({
  root,
  selectedId,
  onSelect,
  warningSpanIds,
}: SpanGraphProps) {
  const { nodes, edges } = useMemo(
    () => buildLayout(root, selectedId, warningSpanIds),
    [root, selectedId, warningSpanIds],
  );
  const shape = useMemo(() => summarizeShape(root), [root]);
  const hasHandoffs = shape.handoffs > 0;
  const rfRef = useRef<ReactFlowInstance<Node<SpanNodeData>, Edge> | null>(
    null,
  );
  // Latest node positions, read by the centering helper without making it a
  // dependency — so background data refetches don't yank the viewport.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      onSelect(node.id);
    },
    [onSelect],
  );

  // Center the viewport on the selected span (e.g. a deep-linked `spanId`,
  // or selection synced from another lens) so the focused node is in view —
  // the graph equivalent of the tree scrolling its selected row into view.
  const centerOnSelected = useCallback(
    (animate: boolean): boolean => {
      const inst = rfRef.current;
      if (!inst || !selectedId) return false;
      const n = nodesRef.current.find((nn) => nn.id === selectedId);
      if (!n) return false;
      inst.setCenter(
        n.position.x + NODE_WIDTH / 2,
        n.position.y + NODE_HEIGHT / 2,
        {
          zoom: inst.getZoom() || 1,
          duration: animate ? 400 : 0,
        },
      );
      return true;
    },
    [selectedId],
  );

  // Re-center only when the *selection* changes (not on every data refetch).
  useEffect(() => {
    centerOnSelected(true);
  }, [centerOnSelected]);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        background: "var(--qw-bg)",
      }}
    >
      {/* Run-shape summary chip (design `RunDetailGraph`, top-right). */}
      <div
        className="absolute right-4 top-3.5 z-10 flex items-center gap-2 rounded-[8px] px-3 py-1.5 font-mono text-[11px]"
        style={{
          background: "var(--qw-bg-muted)",
          color: "var(--qw-fg-muted)",
          boxShadow: "inset 0 0 0 1px var(--qw-border)",
        }}
      >
        {shapeChipLabel(shape)}
      </div>

      {/* Typed-edge legend (design Graph vocabulary, bottom-center). */}
      <div
        className="absolute bottom-3.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3.5 rounded-[8px] px-3 py-1.5 font-mono text-[10.5px]"
        style={{
          background: "var(--qw-bg-elev)",
          color: "var(--qw-fg-muted)",
          boxShadow: "inset 0 0 0 1px var(--qw-border)",
        }}
      >
        <LegendEdge
          label="parent"
          color="var(--qw-border-strong, var(--qw-border))"
        />
        {hasHandoffs && (
          <LegendEdge label="handoff" color="var(--qw-iris)" dash="5 4" />
        )}
        <span style={{ color: "var(--qw-fg-faint)" }}>node = span</span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onInit={(inst) => {
          rfRef.current = inst;
          // Defer one frame so node sizes are measured, then either focus the
          // deep-linked / selected node or frame the whole run.
          requestAnimationFrame(() => {
            if (!centerOnSelected(false))
              inst.fitView({ padding: 0.15, maxZoom: 1.2 });
          });
        }}
        fitViewOptions={{ padding: 0.15, maxZoom: 1.2 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        elementsSelectable
      >
        <Background gap={20} size={1} color="var(--qw-border)" />
        <Controls position="bottom-right" showInteractive={false} />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          maskColor="var(--qw-bg)"
          nodeColor={(n) =>
            ((n.data as SpanNodeData).accent as string) ?? "var(--qw-fg-muted)"
          }
          style={{
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
          }}
        />
      </ReactFlow>
    </div>
  );
}
