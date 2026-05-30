import { useMemo, useCallback, memo } from 'react'
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Trace } from '@/types'
import { fmt } from '@/shared/components/ui-atoms'
import { buildSteps, layoutSteps, type StepData, type LayoutStep } from './FlowWaterfall'

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

interface SessionCanvasProps {
  traces: Trace[]
  onSelectTrace: (traceId: string) => void
  onSelectFlow?: (flowId: string) => void
  selectedTraceId?: string | null
  flowNameMap?: Map<string, string>
  className?: string
}

// ─────────────────────────────────────────────────────────────────
// Flow tree — builds hierarchy using parentFlowId
// ─────────────────────────────────────────────────────────────────

interface FlowNode {
  flowId: string
  parentFlowId?: string
  name: string
  traces: Trace[]
  children: FlowNode[]
  startedAt: number
  endedAt: number
  durationMs: number
  totalTokens: number
  totalCost: number
  traceCount: number // includes children
  status: 'success' | 'error' | 'running'
}

function buildFlowTree(traces: Trace[], nameMap?: Map<string, string>): { roots: FlowNode[]; standalone: Trace[] } {
  const byFlow = new Map<string, Trace[]>()
  const standalone: Trace[] = []

  for (const t of traces) {
    if (t.flowId) {
      let list = byFlow.get(t.flowId)
      if (!list) {
        list = []
        byFlow.set(t.flowId, list)
      }
      list.push(t)
    } else {
      standalone.push(t)
    }
  }

  const nodeMap = new Map<string, FlowNode>()
  for (const [flowId, flowTraces] of byFlow) {
    flowTraces.sort((a, b) => a.startedAt - b.startedAt)
    const now = Date.now()
    const startedAt = flowTraces[0]!.startedAt
    const endedAt = Math.max(
      ...flowTraces.map((t) => (t.status === 'running' ? now : t.startedAt + (t.durationMs ?? 0))),
    )
    const totalTokens = flowTraces.reduce((sum, t) => sum + (t.result?.usage?.totalTokens ?? 0), 0)
    const totalCost = flowTraces.reduce((sum, t) => sum + (t.result?.cost ?? 0), 0)
    const hasError = flowTraces.some((t) => t.status === 'error')
    const isRunning = flowTraces.some((t) => t.status === 'running')
    const parentFlowId = flowTraces.find((t) => t.parentFlowId)?.parentFlowId
    const stepLabels = [...new Set(flowTraces.map((t) => t.stepLabel).filter((l): l is string => l != null))]

    nodeMap.set(flowId, {
      flowId,
      parentFlowId,
      name: nameMap?.get(flowId) ?? (stepLabels.length > 0 ? stepLabels.join(' → ') : 'flow'),
      traces: flowTraces,
      children: [],
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      totalTokens,
      totalCost,
      traceCount: flowTraces.length,
      status: hasError ? 'error' : isRunning ? 'running' : 'success',
    })
  }

  // Create synthetic parent nodes for parentFlowIds that have no direct traces.
  // This handles cross-action boundaries where the parent flow may not have its own traces.
  for (const node of [...nodeMap.values()]) {
    if (node.parentFlowId && !nodeMap.has(node.parentFlowId)) {
      nodeMap.set(node.parentFlowId, {
        flowId: node.parentFlowId,
        name: nameMap?.get(node.parentFlowId) ?? 'pipeline',
        traces: [],
        children: [],
        startedAt: node.startedAt,
        endedAt: node.endedAt,
        durationMs: 0,
        totalTokens: 0,
        totalCost: 0,
        traceCount: 0,
        status: 'success',
      })
    }
  }

  const roots: FlowNode[] = []
  for (const node of nodeMap.values()) {
    if (node.parentFlowId && nodeMap.has(node.parentFlowId)) {
      nodeMap.get(node.parentFlowId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Finalize: sort children, aggregate stats up to parent
  function finalize(node: FlowNode): void {
    node.children.sort((a, b) => a.startedAt - b.startedAt)
    for (const child of node.children) finalize(child)
    if (node.children.length > 0) {
      for (const child of node.children) {
        node.totalTokens += child.totalTokens
        node.totalCost += child.totalCost
        node.traceCount += child.traceCount
      }
      const allEndedAt = Math.max(node.endedAt, ...node.children.map((c) => c.endedAt))
      node.durationMs = allEndedAt - node.startedAt
      node.endedAt = allEndedAt
      if (node.children.some((c) => c.status === 'error')) node.status = 'error'
      else if (node.children.some((c) => c.status === 'running') || node.status === 'running') node.status = 'running'
    }
  }
  for (const root of roots) finalize(root)
  roots.sort((a, b) => a.startedAt - b.startedAt)
  standalone.sort((a, b) => a.startedAt - b.startedAt)
  return { roots, standalone }
}

// ─────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────

const STEP_W = 130
const STEP_H = 52
const STEP_GAP_X = 28
const STEP_GAP_Y = 12
const CF_PAD_X = 14
const CF_PAD_TOP = 28
const CF_PAD_BOTTOM = 12
const CF_GAP_X = 20
const CF_GAP_Y = 16
const ROOT_PAD_X = 18
const ROOT_PAD_TOP = 38
const ROOT_PAD_BOTTOM = 16
const ROOT_GAP_Y = 28
const STANDALONE_W = 160
const STANDALONE_H = 48

// ─────────────────────────────────────────────────────────────────
// Node data types
// ─────────────────────────────────────────────────────────────────

interface RootFlowData extends Record<string, unknown> {
  flowId: string
  name: string
  status: 'success' | 'error' | 'running'
  durationMs: number
  totalTokens: number
  totalCost: number
  traceCount: number
  childCount: number
  width: number
  height: number
}

interface ChildFlowData extends Record<string, unknown> {
  flowId: string
  name: string
  status: 'success' | 'error' | 'running'
  durationMs: number
  totalTokens: number
  totalCost: number
  traceCount: number
  width: number
  height: number
}

interface StepNodeData extends Record<string, unknown> {
  stepLabel: string
  traceCount: number
  totalDurationMs: number
  totalTokens: number
  totalCost: number
  status: StepData['status']
  selected: boolean
  firstTraceId: string
  model: string
  hasError: boolean
}

interface StandaloneData extends Record<string, unknown> {
  traceId: string
  promptId: string
  model: string
  status: string
  durationMs?: number
  selected: boolean
}

// ─────────────────────────────────────────────────────────────────
// Measure helpers (compute dimensions before placing nodes)
// ─────────────────────────────────────────────────────────────────

function measureStepGrid(steps: LayoutStep[]): {
  width: number
  height: number
} {
  if (steps.length === 0) return { width: 0, height: 0 }
  const maxCol = Math.max(...steps.map((s) => s.col), 0)
  const maxRow = Math.max(...steps.map((s) => s.row), 0)
  return {
    width: (maxCol + 1) * STEP_W + maxCol * STEP_GAP_X,
    height: (maxRow + 1) * (STEP_H + STEP_GAP_Y) - STEP_GAP_Y,
  }
}

function measureChildFlow(traces: Trace[]): {
  steps: LayoutStep[]
  width: number
  height: number
} {
  const steps = layoutSteps(buildSteps(traces))
  const grid = measureStepGrid(steps)
  const width = Math.max(grid.width + CF_PAD_X * 2, STEP_W + CF_PAD_X * 2)
  const height = CF_PAD_TOP + (grid.height > 0 ? grid.height : STEP_H) + CF_PAD_BOTTOM
  return { steps, width, height }
}

// ─────────────────────────────────────────────────────────────────
// Build the full graph
// Uses 2-level nesting only: root flow → (own steps + child flow groups)
// Child flow groups contain their own steps via parentId
// ─────────────────────────────────────────────────────────────────

function buildGraph(
  roots: FlowNode[],
  standalone: Trace[],
  selectedTraceId: string | null | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  let yOffset = 0

  for (const root of roots) {
    // Measure own steps
    const ownSteps = layoutSteps(buildSteps(root.traces))
    const ownGrid = measureStepGrid(ownSteps)

    // Measure child flows
    const childMeasurements = root.children.map((child) => measureChildFlow(child.traces))
    let childrenTotalWidth = 0
    let childrenMaxHeight = 0
    for (let i = 0; i < childMeasurements.length; i++) {
      childrenTotalWidth += childMeasurements[i]!.width
      if (i < childMeasurements.length - 1) childrenTotalWidth += CF_GAP_X
      childrenMaxHeight = Math.max(childrenMaxHeight, childMeasurements[i]!.height)
    }

    // Root dimensions
    const contentWidth = Math.max(ownGrid.width, childrenTotalWidth)
    const rootWidth = contentWidth + ROOT_PAD_X * 2
    const stepsBlockHeight = ownGrid.height > 0 ? ownGrid.height : 0
    const childBlockHeight = childrenMaxHeight > 0 ? childrenMaxHeight : 0
    const gapBetween = stepsBlockHeight > 0 && childBlockHeight > 0 ? CF_GAP_Y : 0
    const rootHeight = ROOT_PAD_TOP + stepsBlockHeight + gapBetween + childBlockHeight + ROOT_PAD_BOTTOM

    const rootNodeId = `root-${root.flowId}`

    // Root flow group node
    nodes.push({
      id: rootNodeId,
      type: 'rootFlow',
      position: { x: 0, y: yOffset },
      data: {
        flowId: root.flowId,
        name: root.name,
        status: root.status,
        durationMs: root.durationMs,
        totalTokens: root.totalTokens,
        totalCost: root.totalCost,
        traceCount: root.traceCount,
        childCount: root.children.length,
        width: rootWidth,
        height: rootHeight,
      } satisfies RootFlowData,
      style: { width: rootWidth, height: rootHeight },
    })

    // Own step nodes — children of root
    const ownColX = new Map<number, number>()
    const ownMaxCol = ownSteps.length > 0 ? Math.max(...ownSteps.map((s) => s.col), 0) : -1
    let xc = ROOT_PAD_X
    for (let c = 0; c <= ownMaxCol; c++) {
      ownColX.set(c, xc)
      xc += STEP_W + STEP_GAP_X
    }

    for (const step of ownSteps) {
      const nodeId = `step-${root.flowId}-${step.stepId}`
      nodes.push({
        id: nodeId,
        type: 'stepNode',
        parentId: rootNodeId,
        extent: 'parent' as const,
        position: {
          x: ownColX.get(step.col) ?? ROOT_PAD_X,
          y: ROOT_PAD_TOP + step.row * (STEP_H + STEP_GAP_Y),
        },
        data: {
          stepLabel: step.stepLabel,
          traceCount: step.traceCount,
          totalDurationMs: step.totalDurationMs,
          totalTokens: step.totalTokens,
          totalCost: step.totalCost,
          status: step.status,
          selected: step.traces.some((t) => t.traceId === selectedTraceId),
          firstTraceId: step.firstTraceId,
          model: step.model ? step.model.replace(/^[^/]+\//, '').slice(0, 14) : '',
          hasError: step.hasError,
        } satisfies StepNodeData,
      } as Node)
    }

    // Edges between own steps
    const ownByCol = new Map<number, LayoutStep[]>()
    for (const s of ownSteps) {
      let list = ownByCol.get(s.col)
      if (!list) {
        list = []
        ownByCol.set(s.col, list)
      }
      list.push(s)
    }
    for (let c = 0; c < ownMaxCol; c++) {
      for (const src of ownByCol.get(c) ?? []) {
        for (const tgt of ownByCol.get(c + 1) ?? []) {
          edges.push({
            id: `${root.flowId}:${src.stepId}->${tgt.stepId}`,
            source: `step-${root.flowId}-${src.stepId}`,
            target: `step-${root.flowId}-${tgt.stepId}`,
            animated: src.status === 'running' || tgt.status === 'running',
            type: 'smoothstep',
            style: {
              stroke: tgt.hasError
                ? '#f87171'
                : src.status === 'running' || tgt.status === 'running'
                  ? '#60a5fa'
                  : '#52525b',
              strokeWidth: 1.5,
            },
          })
        }
      }
    }

    // Child flow groups — children of root, positioned below own steps
    const childY = ROOT_PAD_TOP + stepsBlockHeight + gapBetween
    let childX = ROOT_PAD_X

    for (let ci = 0; ci < root.children.length; ci++) {
      const child = root.children[ci]!
      const cm = childMeasurements[ci]!
      const cfNodeId = `cf-${child.flowId}`

      // Child flow group node (child of root)
      nodes.push({
        id: cfNodeId,
        type: 'childFlow',
        parentId: rootNodeId,
        extent: 'parent' as const,
        position: { x: childX, y: childY },
        data: {
          flowId: child.flowId,
          name: child.name,
          status: child.status,
          durationMs: child.durationMs,
          totalTokens: child.totalTokens,
          totalCost: child.totalCost,
          traceCount: child.traces.length,
          width: cm.width,
          height: cm.height,
        } satisfies ChildFlowData,
        style: { width: cm.width, height: cm.height },
      } as Node)

      // Steps inside child flow (children of child flow group)
      const cfColX = new Map<number, number>()
      const cfMaxCol = cm.steps.length > 0 ? Math.max(...cm.steps.map((s) => s.col), 0) : -1
      let cfXc = CF_PAD_X
      for (let c = 0; c <= cfMaxCol; c++) {
        cfColX.set(c, cfXc)
        cfXc += STEP_W + STEP_GAP_X
      }

      for (const step of cm.steps) {
        const csId = `cfstep-${child.flowId}-${step.stepId}`
        nodes.push({
          id: csId,
          type: 'stepNode',
          parentId: cfNodeId,
          extent: 'parent' as const,
          position: {
            x: cfColX.get(step.col) ?? CF_PAD_X,
            y: CF_PAD_TOP + step.row * (STEP_H + STEP_GAP_Y),
          },
          data: {
            stepLabel: step.stepLabel,
            traceCount: step.traceCount,
            totalDurationMs: step.totalDurationMs,
            totalTokens: step.totalTokens,
            totalCost: step.totalCost,
            status: step.status,
            selected: step.traces.some((t) => t.traceId === selectedTraceId),
            firstTraceId: step.firstTraceId,
            model: step.model ? step.model.replace(/^[^/]+\//, '').slice(0, 14) : '',
            hasError: step.hasError,
          } satisfies StepNodeData,
        } as Node)
      }

      // Edges between child steps
      const cfByCol = new Map<number, LayoutStep[]>()
      for (const s of cm.steps) {
        let list = cfByCol.get(s.col)
        if (!list) {
          list = []
          cfByCol.set(s.col, list)
        }
        list.push(s)
      }
      for (let c = 0; c < cfMaxCol; c++) {
        for (const src of cfByCol.get(c) ?? []) {
          for (const tgt of cfByCol.get(c + 1) ?? []) {
            edges.push({
              id: `cf-${child.flowId}:${src.stepId}->${tgt.stepId}`,
              source: `cfstep-${child.flowId}-${src.stepId}`,
              target: `cfstep-${child.flowId}-${tgt.stepId}`,
              animated: src.status === 'running' || tgt.status === 'running',
              type: 'smoothstep',
              style: {
                stroke: tgt.hasError
                  ? '#f87171'
                  : src.status === 'running' || tgt.status === 'running'
                    ? '#60a5fa'
                    : '#52525b',
                strokeWidth: 1.5,
              },
            })
          }
        }
      }

      // Edge: parent's last step → child flow
      if (ownSteps.length > 0) {
        const lastColSteps = ownByCol.get(ownMaxCol)
        if (lastColSteps && lastColSteps.length > 0) {
          edges.push({
            id: `${root.flowId}->child-${child.flowId}`,
            source: `step-${root.flowId}-${lastColSteps[0]!.stepId}`,
            target: cfNodeId,
            animated: child.status === 'running',
            type: 'smoothstep',
            style: {
              stroke: '#7c3aed',
              strokeWidth: 2,
              strokeDasharray: '5 3',
            },
          })
        }
      }

      // Edge: connect sequential child flows
      if (ci > 0) {
        const prev = root.children[ci - 1]!
        edges.push({
          id: `cf-${prev.flowId}->cf-${child.flowId}`,
          source: `cf-${prev.flowId}`,
          target: `cf-${child.flowId}`,
          animated: child.status === 'running',
          type: 'smoothstep',
          style: {
            stroke: '#3f3f46',
            strokeWidth: 1.5,
            strokeDasharray: '6 4',
          },
        })
      }

      childX += cm.width + CF_GAP_X
    }

    yOffset += rootHeight + ROOT_GAP_Y
  }

  // Edges between root flows
  for (let i = 0; i < roots.length - 1; i++) {
    edges.push({
      id: `root-${roots[i]!.flowId}->root-${roots[i + 1]!.flowId}`,
      source: `root-${roots[i]!.flowId}`,
      target: `root-${roots[i + 1]!.flowId}`,
      animated: roots[i + 1]!.status === 'running',
      type: 'smoothstep',
      style: { stroke: '#3f3f46', strokeWidth: 2, strokeDasharray: '6 4' },
    })
  }

  // Standalone traces
  if (standalone.length > 0) {
    for (let i = 0; i < standalone.length; i++) {
      const t = standalone[i]!
      nodes.push({
        id: `sa-${t.traceId}`,
        type: 'standaloneTrace',
        position: { x: i * (STANDALONE_W + 16), y: yOffset },
        data: {
          traceId: t.traceId,
          promptId: t.promptId ?? 'unnamed',
          model: t.model.replace(/^[^/]+\//, '').slice(0, 14),
          status: t.status,
          durationMs: t.durationMs,
          selected: t.traceId === selectedTraceId,
        } satisfies StandaloneData,
      } as Node)
    }
  }

  return { nodes, edges }
}

// ─────────────────────────────────────────────────────────────────
// Custom node components
// ─────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  success: {
    border: '#065f46',
    bg: 'rgba(6,78,59,0.15)',
    badge: 'bg-emerald-900/50 text-emerald-400',
  },
  error: {
    border: '#991b1b',
    bg: 'rgba(127,29,29,0.15)',
    badge: 'bg-red-900/50 text-red-400',
  },
  running: {
    border: '#1e40af',
    bg: 'rgba(30,58,138,0.15)',
    badge: 'bg-blue-900/50 text-blue-400',
  },
}

// Root flow — outermost container with thick border
const RootFlowNode = memo(function RootFlowNode({ data }: NodeProps<Node<RootFlowData>>) {
  const s = STATUS_MAP[data.status]
  return (
    <div
      className="rounded-xl cursor-pointer"
      style={{
        width: data.width,
        height: data.height,
        border: `2.5px solid ${s.border}`,
        background: s.bg,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-(--qw-border)/40">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${s.badge} rounded-md px-1.5 py-0.5`}>
          {data.childCount > 0 ? 'Pipeline' : 'Flow'}
        </span>
        <span className="text-[12px] font-mono text-(--qw-fg) font-semibold truncate">{data.name}</span>
        <div className="ml-auto flex items-center gap-2 text-[10px] text-(--qw-fg-muted) tabular-nums">
          <span>{fmt(data.durationMs, 'ms')}</span>
          {data.totalTokens > 0 && <span>{fmt(data.totalTokens, 'tok')}</span>}
          {data.totalCost > 0 && <span className="text-emerald-400/70">{fmt(data.totalCost, '$')}</span>}
          <span className="text-(--qw-fg-faint)">{data.traceCount}x</span>
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="!bg-(--qw-fg-faint) !w-2.5 !h-2.5 !border-0 !-top-1.5" />
      <Handle type="source" position={Position.Bottom} className="!bg-(--qw-fg-faint) !w-2.5 !h-2.5 !border-0 !-bottom-1.5" />
    </div>
  )
})

// Child flow — nested inside root, distinct violet styling
const ChildFlowNode = memo(function ChildFlowNode({ data }: NodeProps<Node<ChildFlowData>>) {
  const isError = data.status === 'error'
  const isRunning = data.status === 'running'

  return (
    <div
      className="rounded-lg cursor-pointer"
      style={{
        width: data.width,
        height: data.height,
        border: `2px solid ${isError ? 'rgba(127,29,29,0.5)' : isRunning ? 'rgba(30,58,138,0.5)' : 'rgba(109,40,217,0.3)'}`,
        background: isError ? 'rgba(127,29,29,0.1)' : isRunning ? 'rgba(30,58,138,0.1)' : 'rgba(109,40,217,0.08)',
      }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider rounded px-1 py-0.5 ${
            isError
              ? 'bg-red-900/50 text-red-400'
              : isRunning
                ? 'bg-blue-900/50 text-blue-400'
                : 'bg-violet-900/50 text-violet-400'
          }`}
        >
          Sub-flow
        </span>
        <span className="text-[10px] font-mono text-violet-200 font-medium truncate">{data.name}</span>
        <div className="ml-auto flex items-center gap-1.5 text-[9px] text-(--qw-fg-faint) tabular-nums">
          <span>{fmt(data.durationMs, 'ms')}</span>
          {data.totalCost > 0 && <span className="text-emerald-400/60">{fmt(data.totalCost, '$')}</span>}
        </div>
      </div>
      <Handle type="target" position={Position.Top} className="!bg-violet-500 !w-2 !h-2 !border-0 !-top-1" />
      <Handle type="source" position={Position.Bottom} className="!bg-violet-500 !w-2 !h-2 !border-0 !-bottom-1" />
    </div>
  )
})

// Step node — shared by both root and child flows
const STEP_STATUS: Record<StepData['status'], { dot: string; bg: string; border: string }> = {
  success: {
    dot: 'bg-emerald-400',
    bg: 'bg-(--qw-bg-elev)/80',
    border: 'border-(--qw-border-strong)/60',
  },
  error: {
    dot: 'bg-red-400',
    bg: 'bg-red-950/40',
    border: 'border-red-800/40',
  },
  running: {
    dot: 'bg-blue-400',
    bg: 'bg-blue-950/40',
    border: 'border-blue-800/40',
  },
  slow: {
    dot: 'bg-amber-400',
    bg: 'bg-amber-950/40',
    border: 'border-amber-800/40',
  },
}

const StepNode = memo(function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const s = STEP_STATUS[data.status]
  const ring = data.selected ? 'ring-2 ring-(--qw-fg-muted)/60' : ''

  return (
    <div
      className={`rounded border ${s.bg} ${s.border} ${ring} cursor-pointer hover:brightness-110 transition-all`}
      style={{ width: STEP_W, height: STEP_H }}
    >
      <Handle type="target" position={Position.Left} className="!bg-(--qw-border) !w-1.5 !h-1.5 !border-0" />
      <Handle type="source" position={Position.Right} className="!bg-(--qw-border) !w-1.5 !h-1.5 !border-0" />
      <div className="px-2 py-1.5">
        <div className="flex items-center gap-1 mb-0.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${s.dot} shrink-0 ${data.status === 'running' ? 'animate-pulse' : ''}`}
          />
          <span className="text-[10px] font-medium text-(--qw-fg) truncate">{data.stepLabel}</span>
          {data.traceCount > 1 && <span className="text-[9px] text-(--qw-fg-faint)">{data.traceCount}x</span>}
        </div>
        {data.model && <div className="text-[8px] text-(--qw-fg-faint) font-mono truncate mb-0.5">{data.model}</div>}
        <div className="flex items-center gap-1.5 text-[9px] text-(--qw-fg-faint) tabular-nums">
          <span>{fmt(data.totalDurationMs, 'ms')}</span>
          {data.totalCost > 0 && <span className="text-emerald-400/60">{fmt(data.totalCost, '$')}</span>}
        </div>
      </div>
    </div>
  )
})

// Standalone trace node
const StandaloneNode = memo(function StandaloneNode({ data }: NodeProps<Node<StandaloneData>>) {
  const ring = data.selected ? 'ring-2 ring-(--qw-fg-muted)/60' : ''
  const dot = data.status === 'running' ? 'bg-blue-400' : data.status === 'error' ? 'bg-red-400' : 'bg-emerald-400'

  return (
    <div
      className={`rounded border border-(--qw-border-strong)/60 bg-(--qw-bg-elev)/80 ${ring} cursor-pointer hover:brightness-110 transition-all`}
      style={{ width: STANDALONE_W, height: STANDALONE_H }}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`w-1.5 h-1.5 rounded-full ${dot} shrink-0`} />
          <span className="text-[10px] font-medium text-(--qw-fg) truncate">{data.promptId}</span>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-(--qw-fg-faint) tabular-nums">
          {data.model && <span className="font-mono">{data.model}</span>}
          {data.durationMs != null && <span>{fmt(data.durationMs, 'ms')}</span>}
        </div>
      </div>
    </div>
  )
})

const nodeTypes = {
  rootFlow: RootFlowNode,
  childFlow: ChildFlowNode,
  stepNode: StepNode,
  standaloneTrace: StandaloneNode,
}

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────

export function SessionCanvas({
  traces,
  onSelectTrace,
  onSelectFlow,
  selectedTraceId,
  flowNameMap,
  className,
}: SessionCanvasProps) {
  const { nodes, edges } = useMemo(() => {
    const { roots, standalone } = buildFlowTree(traces, flowNameMap)
    return buildGraph(roots, standalone, selectedTraceId)
  }, [traces, selectedTraceId, flowNameMap])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'stepNode') {
        const data = node.data as StepNodeData
        onSelectTrace(data.firstTraceId)
      } else if (node.type === 'standaloneTrace') {
        const data = node.data as StandaloneData
        onSelectTrace(data.traceId)
      } else if (node.type === 'rootFlow' && onSelectFlow) {
        onSelectFlow((node.data as RootFlowData).flowId)
      } else if (node.type === 'childFlow' && onSelectFlow) {
        onSelectFlow((node.data as ChildFlowData).flowId)
      }
    },
    [onSelectTrace, onSelectFlow],
  )

  if (nodes.length === 0) {
    return (
      <div className={`h-[400px] flex items-center justify-center text-sm text-(--qw-fg-faint) ${className ?? ''}`}>
        No traces in this session
      </div>
    )
  }

  return (
    <div className={`h-[400px] rounded-lg border border-(--qw-border) bg-(--qw-bg) ${className ?? ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.15}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#27272a" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-(--qw-bg-elev) !border-(--qw-border-strong) !shadow-none [&>button]:!bg-(--qw-bg-muted) [&>button]:!border-(--qw-border-strong) [&>button]:!text-(--qw-fg-muted) [&>button:hover]:!bg-(--qw-border-strong)"
        />
      </ReactFlow>
    </div>
  )
}
