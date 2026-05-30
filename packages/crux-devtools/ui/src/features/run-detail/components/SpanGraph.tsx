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

import { useMemo, useCallback, memo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { SpanNode } from '@/features/observability/lib/span-tree'

const NODE_WIDTH = 220
const NODE_HEIGHT = 56
const X_GAP = 60
const Y_GAP = 18

const KIND_ACCENT: Record<string, string> = {
  session: 'var(--qw-iris)',
  flow: 'var(--qw-crux)',
  composition: 'var(--qw-warn)',
  step: 'var(--qw-iris)',
  handoff: 'var(--qw-fg-muted)',
  trace: 'var(--qw-warn)',
}

const PRIMITIVE_ACCENT: Record<string, string> = {
  'agent.run': 'var(--qw-iris)',
  'generation.call': 'var(--qw-warn)',
  'generation.stream': 'var(--qw-warn)',
  'tool.call': 'var(--qw-fg-muted)',
  'memory.read': 'var(--qw-iris)',
  'memory.write': 'var(--qw-iris)',
  'handoff.prepare': 'var(--qw-fg-faint)',
  'delegate.invoke': 'var(--qw-fg-faint)',
  'retrieval.query': 'var(--qw-ok)',
  'flow.run': 'var(--qw-crux)',
  'flow.step': 'var(--qw-iris)',
  'flow.suspension': 'var(--qw-iris)',
  'composition.parallel': 'var(--qw-warn)',
  'composition.swarm': 'var(--qw-iris)',
  'plan.operation': 'var(--qw-ok)',
}

const STATUS_BG: Record<string, string> = {
  success: 'var(--qw-bg-elev)',
  running: 'var(--qw-crux-soft)',
  error: 'var(--qw-danger-soft)',
  stale: 'var(--qw-warn-soft)',
}

function accentFor(node: SpanNode): string {
  return PRIMITIVE_ACCENT[node.primitive ?? ''] ?? KIND_ACCENT[node.kind] ?? 'var(--qw-fg-muted)'
}

function fmtDuration(ms: number | undefined): string {
  if (ms == null) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

interface SpanNodeData extends Record<string, unknown> {
  label: string
  primitive: string
  durationMs?: number
  status: SpanNode['status']
  selected: boolean
  accent: string
}

const SpanNodeView = memo(function SpanNodeView({ data }: NodeProps<Node<SpanNodeData>>) {
  const bg = STATUS_BG[data.status] ?? 'var(--qw-bg-elev)'
  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        background: bg,
        border: `1px solid ${data.selected ? 'var(--qw-crux)' : 'var(--qw-border)'}`,
        borderLeft: `3px solid ${data.accent}`,
        borderRadius: 8,
        padding: '8px 10px',
        boxShadow: data.selected ? '0 0 0 2px var(--qw-crux-soft)' : undefined,
        fontFamily: 'var(--qw-mono)',
        fontSize: 11,
        color: 'var(--qw-fg)',
        overflow: 'hidden',
        cursor: 'pointer',
      }}
      title={`${data.primitive} · ${data.label}`}
    >
      <Handle type="target" position={Position.Left} style={{ background: 'transparent', border: 0 }} />
      <div
        style={{
          color: data.accent,
          fontSize: 9.5,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontWeight: 600,
          marginBottom: 2,
        }}
      >
        {data.primitive}
      </div>
      <div
        style={{
          color: 'var(--qw-fg)',
          fontSize: 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {data.label}
      </div>
      <div style={{ color: 'var(--qw-fg-muted)', fontSize: 10, marginTop: 2 }}>
        {data.status} · {fmtDuration(data.durationMs)}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'transparent', border: 0 }} />
    </div>
  )
})

const nodeTypes = { span: SpanNodeView }

/**
 * Build ReactFlow nodes + edges by recursing the SpanNode tree.
 * Each level of depth shifts x by (NODE_WIDTH + X_GAP), siblings stack
 * by y inside their parent's vertical band.
 */
function buildLayout(
  root: SpanNode,
  selectedId: string | null,
): { nodes: Node<SpanNodeData>[]; edges: Edge[]; height: number } {
  const nodes: Node<SpanNodeData>[] = []
  const edges: Edge[] = []

  function leafCount(n: SpanNode): number {
    if (!n.children || n.children.length === 0) return 1
    return n.children.reduce((sum, c) => sum + leafCount(c), 0)
  }

  function place(n: SpanNode, depth: number, yTop: number): number {
    const leaves = leafCount(n)
    const span = leaves * NODE_HEIGHT + (leaves - 1) * Y_GAP
    const y = yTop + span / 2 - NODE_HEIGHT / 2
    const x = depth * (NODE_WIDTH + X_GAP)
    const isSelected = n.id === selectedId
    nodes.push({
      id: n.id,
      type: 'span',
      position: { x, y },
      data: {
        label: n.label || n.primitive || n.id,
        primitive: n.primitive ?? n.kind,
        durationMs: n.durationMs,
        status: n.status,
        selected: isSelected,
        accent: accentFor(n),
      },
      draggable: false,
      selectable: true,
    })
    let cursor = yTop
    for (const c of n.children ?? []) {
      const childLeaves = leafCount(c)
      const childSpan = childLeaves * NODE_HEIGHT + (childLeaves - 1) * Y_GAP
      edges.push({
        id: `${n.id}->${c.id}`,
        source: n.id,
        target: c.id,
        type: 'smoothstep',
        style: { stroke: 'var(--qw-border-strong, var(--qw-border))', strokeWidth: 1.2 },
      })
      place(c, depth + 1, cursor)
      cursor += childSpan + Y_GAP
    }
    return span
  }

  const totalHeight = place(root, 0, 0)
  return { nodes, edges, height: totalHeight }
}

export interface SpanGraphProps {
  root: SpanNode
  selectedId: string | null
  onSelect: (id: string) => void
}

export function SpanGraph({ root, selectedId, onSelect }: SpanGraphProps) {
  const { nodes, edges } = useMemo(() => buildLayout(root, selectedId), [root, selectedId])
  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      onSelect(node.id)
    },
    [onSelect],
  )

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--qw-bg)' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView
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
          nodeColor={(n) => ((n.data as SpanNodeData).accent as string) ?? 'var(--qw-fg-muted)'}
          style={{ background: 'var(--qw-bg-elev)', border: '1px solid var(--qw-border)' }}
        />
      </ReactFlow>
    </div>
  )
}
