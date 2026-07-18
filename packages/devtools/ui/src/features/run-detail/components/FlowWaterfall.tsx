import { useMemo, useCallback, memo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Trace } from "@/types";
import { fmt } from "@/shared/components/ui-atoms";

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────

interface FlowWaterfallProps {
  traces: Trace[];
  /** All traces in the session — used to find child flow traces via parentFlowId */
  allSessionTraces?: Trace[];
  onSelectTrace: (traceId: string) => void;
  onSelectFlow?: (flowId: string) => void;
  selectedTraceId?: string | null;
  /** Map flowId → human-readable name */
  flowNameMap?: Map<string, string>;
  className?: string;
}

// ─────────────────────────────────────────────────────────────────
// Step aggregation
// ─────────────────────────────────────────────────────────────────

export interface StepData {
  stepId: string;
  stepLabel: string;
  traces: Trace[];
  traceCount: number;
  totalDurationMs: number;
  totalCost: number;
  totalTokens: number;
  startedAt: number;
  endedAt: number;
  status: "success" | "error" | "running" | "slow";
  model: string;
  firstTraceId: string;
  hasError: boolean;
  errorMessage?: string;
}

const PARALLEL_THRESHOLD_MS = 100;
const NODE_MIN_W = 160;
const NODE_MAX_W = 350;
const NODE_H = 80;
const NODE_GAP_X = 50;
const NODE_GAP_Y = 20;

export function buildSteps(traces: Trace[]): StepData[] {
  const grouped = new Map<string, Trace[]>();
  const order: string[] = [];

  for (const t of traces) {
    const key = t.stepId ?? t.traceId;
    let list = grouped.get(key);
    if (!list) {
      list = [];
      grouped.set(key, list);
      order.push(key);
    }
    list.push(t);
  }

  const steps: StepData[] = [];
  for (const key of order) {
    const stepTraces = grouped.get(key)!;
    stepTraces.sort((a, b) => a.startedAt - b.startedAt);

    const now = Date.now();
    const startedAt = stepTraces[0]!.startedAt;
    const endedAt = Math.max(
      ...stepTraces.map((t) =>
        t.status === "running" ? now : t.startedAt + (t.durationMs ?? 0),
      ),
    );
    const totalDurationMs = endedAt - startedAt;
    const totalCost = stepTraces.reduce(
      (sum, t) => sum + (t.result?.cost ?? 0),
      0,
    );
    const totalTokens = stepTraces.reduce(
      (sum, t) => sum + (t.result?.usage?.totalTokens ?? 0),
      0,
    );
    const hasError = stepTraces.some((t) => t.status === "error");
    const isRunning = stepTraces.some((t) => t.status === "running");
    const isSlow = totalDurationMs > 10_000;
    const errorTrace = stepTraces.find((t) => t.error);

    const models = stepTraces
      .map((t) => t.model)
      .filter((m) => m !== "resolve-only");
    const model = models.length > 0 ? models[0]! : "";

    let status: StepData["status"] = "success";
    if (hasError) status = "error";
    else if (isRunning) status = "running";
    else if (isSlow) status = "slow";

    steps.push({
      stepId: key,
      stepLabel: stepTraces[0]!.stepLabel ?? stepTraces[0]!.promptId ?? key,
      traces: stepTraces,
      traceCount: stepTraces.length,
      totalDurationMs,
      totalCost,
      totalTokens,
      startedAt,
      endedAt,
      status,
      model,
      hasError,
      errorMessage: errorTrace?.error?.message,
      firstTraceId: stepTraces[0]!.traceId,
    });
  }

  steps.sort((a, b) => a.startedAt - b.startedAt);
  return steps;
}

// ─────────────────────────────────────────────────────────────────
// Layout: assign grid positions (col, row)
// ─────────────────────────────────────────────────────────────────

export interface LayoutStep extends StepData {
  col: number;
  row: number;
  width: number;
}

export function layoutSteps(steps: StepData[]): LayoutStep[] {
  if (steps.length === 0) return [];

  const maxDuration = Math.max(...steps.map((s) => s.totalDurationMs), 1);

  const laid: LayoutStep[] = [];
  let currentCol = 0;
  let colAnchorTime = steps[0]!.startedAt;
  let currentRow = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const width = Math.round(
      NODE_MIN_W +
        (step.totalDurationMs / maxDuration) * (NODE_MAX_W - NODE_MIN_W),
    );

    const isParallel =
      i > 0 &&
      Math.abs(step.startedAt - colAnchorTime) <= PARALLEL_THRESHOLD_MS;

    if (isParallel) {
      currentRow++;
    } else {
      if (i > 0) currentCol++;
      currentRow = 0;
      colAnchorTime = step.startedAt;
    }

    laid.push({ ...step, col: currentCol, row: currentRow, width });
  }

  return laid;
}

// ─────────────────────────────────────────────────────────────────
// Child flow info — used when this flow has nested sub-flows
// ─────────────────────────────────────────────────────────────────

interface ChildFlowInfo {
  flowId: string;
  name: string;
  traces: Trace[];
  steps: LayoutStep[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  totalTokens: number;
  totalCost: number;
  status: "success" | "error" | "running";
  hasError: boolean;
}

function findChildFlows(
  parentFlowId: string,
  allSessionTraces: Trace[],
  nameMap?: Map<string, string>,
): ChildFlowInfo[] {
  // Find traces whose parentFlowId matches this flow
  const childFlowTraces = new Map<string, Trace[]>();
  for (const t of allSessionTraces) {
    if (
      t.parentFlowId === parentFlowId &&
      t.flowId &&
      t.flowId !== parentFlowId
    ) {
      let list = childFlowTraces.get(t.flowId);
      if (!list) {
        list = [];
        childFlowTraces.set(t.flowId, list);
      }
      list.push(t);
    }
  }

  const children: ChildFlowInfo[] = [];
  for (const [flowId, traces] of childFlowTraces) {
    traces.sort((a, b) => a.startedAt - b.startedAt);
    const now = Date.now();
    const startedAt = traces[0]!.startedAt;
    const endedAt = Math.max(
      ...traces.map((t) =>
        t.status === "running" ? now : t.startedAt + (t.durationMs ?? 0),
      ),
    );
    const totalTokens = traces.reduce(
      (sum, t) => sum + (t.result?.usage?.totalTokens ?? 0),
      0,
    );
    const totalCost = traces.reduce((sum, t) => sum + (t.result?.cost ?? 0), 0);
    const hasError = traces.some((t) => t.status === "error");
    const isRunning = traces.some((t) => t.status === "running");
    const stepLabels = [
      ...new Set(
        traces.map((t) => t.stepLabel).filter((l): l is string => l != null),
      ),
    ];

    children.push({
      flowId,
      name:
        nameMap?.get(flowId) ??
        (stepLabels.length > 0 ? stepLabels.join(" → ") : "sub-flow"),
      traces,
      steps: layoutSteps(buildSteps(traces)),
      startedAt,
      endedAt,
      durationMs: endedAt - startedAt,
      totalTokens,
      totalCost,
      status: hasError ? "error" : isRunning ? "running" : "success",
      hasError,
    });
  }

  children.sort((a, b) => a.startedAt - b.startedAt);
  return children;
}

// ─────────────────────────────────────────────────────────────────
// Build react-flow nodes and edges
// ─────────────────────────────────────────────────────────────────

export interface StepNodeData extends Record<string, unknown> {
  stepLabel: string;
  traceCount: number;
  totalDurationMs: number;
  totalCost: number;
  totalTokens: number;
  status: StepData["status"];
  selected: boolean;
  firstTraceId: string;
  width: number;
  model: string;
  hasError: boolean;
  errorMessage?: string;
}

interface ChildFlowNodeData extends Record<string, unknown> {
  flowId: string;
  name: string;
  status: "success" | "error" | "running";
  durationMs: number;
  totalTokens: number;
  totalCost: number;
  traceCount: number;
  stepCount: number;
  width: number;
  height: number;
}

// Constants for child flow groups within the waterfall
const CF_STEP_W = 120;
const CF_STEP_H = 50;
const CF_STEP_GAP_X = 28;
const CF_STEP_GAP_Y = 10;
const CF_PAD_X = 12;
const CF_PAD_TOP = 28;
const CF_PAD_BOTTOM = 10;
const CF_GAP_Y = 16;

function measureChildFlow(child: ChildFlowInfo): {
  width: number;
  height: number;
} {
  if (child.steps.length === 0) {
    return {
      width: CF_STEP_W + CF_PAD_X * 2,
      height: CF_PAD_TOP + CF_STEP_H + CF_PAD_BOTTOM,
    };
  }
  const maxCol = Math.max(...child.steps.map((s) => s.col), 0);
  const maxRow = Math.max(...child.steps.map((s) => s.row), 0);
  const width =
    CF_PAD_X * 2 + (maxCol + 1) * CF_STEP_W + maxCol * CF_STEP_GAP_X;
  const height =
    CF_PAD_TOP +
    (maxRow + 1) * (CF_STEP_H + CF_STEP_GAP_Y) -
    CF_STEP_GAP_Y +
    CF_PAD_BOTTOM;
  return { width, height };
}

function buildGraph(
  laid: LayoutStep[],
  childFlows: ChildFlowInfo[],
  selectedTraceId: string | null | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const colMaxWidth = new Map<number, number>();
  for (const s of laid) {
    const cur = colMaxWidth.get(s.col) ?? 0;
    colMaxWidth.set(s.col, Math.max(cur, s.width));
  }

  const colX = new Map<number, number>();
  let xCursor = 0;
  const maxCol = laid.length > 0 ? Math.max(...laid.map((s) => s.col), 0) : -1;
  for (let c = 0; c <= maxCol; c++) {
    colX.set(c, xCursor);
    xCursor += (colMaxWidth.get(c) ?? NODE_MIN_W) + NODE_GAP_X;
  }

  const nodes: Node[] = laid.map((s) => {
    const isSelected = s.traces.some((t) => t.traceId === selectedTraceId);
    return {
      id: s.stepId,
      type: "stepNode",
      position: {
        x: colX.get(s.col) ?? 0,
        y: s.row * (NODE_H + NODE_GAP_Y),
      },
      data: {
        stepLabel: s.stepLabel,
        traceCount: s.traceCount,
        totalDurationMs: s.totalDurationMs,
        totalCost: s.totalCost,
        totalTokens: s.totalTokens,
        status: s.status,
        selected: isSelected,
        firstTraceId: s.firstTraceId,
        width: s.width,
        model: s.model,
        hasError: s.hasError,
        errorMessage: s.errorMessage,
      },
    };
  });

  // Edges between steps
  const edges: Edge[] = [];
  const byCol = new Map<number, LayoutStep[]>();
  for (const s of laid) {
    let list = byCol.get(s.col);
    if (!list) {
      list = [];
      byCol.set(s.col, list);
    }
    list.push(s);
  }

  for (let c = 0; c < maxCol; c++) {
    const sources = byCol.get(c) ?? [];
    const targets = byCol.get(c + 1) ?? [];
    for (const src of sources) {
      for (const tgt of targets) {
        const isRunning = src.status === "running" || tgt.status === "running";
        const hasError = tgt.hasError;
        edges.push({
          id: `${src.stepId}->${tgt.stepId}`,
          source: src.stepId,
          target: tgt.stepId,
          animated: isRunning,
          type: "smoothstep",
          style: {
            stroke: hasError ? "#f87171" : isRunning ? "#60a5fa" : "#3f3f46",
            strokeWidth: 2,
          },
        });
      }
    }
  }

  // Child flows rendered below the steps
  if (childFlows.length > 0) {
    const maxRow =
      laid.length > 0 ? Math.max(...laid.map((s) => s.row), 0) : -1;
    const stepsBottom =
      maxRow >= 0 ? (maxRow + 1) * (NODE_H + NODE_GAP_Y) + CF_GAP_Y : 0;
    let childX = 0;

    for (let i = 0; i < childFlows.length; i++) {
      const child = childFlows[i]!;
      const { width: cfWidth, height: cfHeight } = measureChildFlow(child);
      const cfNodeId = `cf-${child.flowId}`;

      // Child flow group node
      nodes.push({
        id: cfNodeId,
        type: "childFlowNode",
        position: { x: childX, y: stepsBottom },
        data: {
          flowId: child.flowId,
          name: child.name,
          status: child.status,
          durationMs: child.durationMs,
          totalTokens: child.totalTokens,
          totalCost: child.totalCost,
          traceCount: child.traces.length,
          stepCount: child.steps.length,
          width: cfWidth,
          height: cfHeight,
        } satisfies ChildFlowNodeData,
        style: { width: cfWidth, height: cfHeight },
      } as Node);

      // Steps inside child flow
      const cfMaxCol =
        child.steps.length > 0
          ? Math.max(...child.steps.map((s) => s.col), 0)
          : -1;
      const cfColX = new Map<number, number>();
      let cfXCursor = CF_PAD_X;
      for (let c = 0; c <= cfMaxCol; c++) {
        cfColX.set(c, cfXCursor);
        cfXCursor += CF_STEP_W + CF_STEP_GAP_X;
      }

      for (const step of child.steps) {
        const csNodeId = `cf-step-${child.flowId}-${step.stepId}`;
        const isSelected = step.traces.some(
          (t) => t.traceId === selectedTraceId,
        );

        nodes.push({
          id: csNodeId,
          type: "childStepNode",
          parentId: cfNodeId,
          extent: "parent" as const,
          position: {
            x: cfColX.get(step.col) ?? CF_PAD_X,
            y: CF_PAD_TOP + step.row * (CF_STEP_H + CF_STEP_GAP_Y),
          },
          data: {
            stepLabel: step.stepLabel,
            traceCount: step.traceCount,
            totalDurationMs: step.totalDurationMs,
            totalTokens: step.totalTokens,
            totalCost: step.totalCost,
            status: step.status,
            selected: isSelected,
            firstTraceId: step.firstTraceId,
            width: CF_STEP_W,
            model: step.model
              ? step.model.replace(/^[^/]+\//, "").slice(0, 14)
              : "",
            hasError: step.hasError,
            errorMessage: step.errorMessage,
          } satisfies StepNodeData,
        } as Node);
      }

      // Edges between child steps
      const cfByCol = new Map<number, LayoutStep[]>();
      for (const s of child.steps) {
        let list = cfByCol.get(s.col);
        if (!list) {
          list = [];
          cfByCol.set(s.col, list);
        }
        list.push(s);
      }
      for (let c = 0; c < cfMaxCol; c++) {
        const sources = cfByCol.get(c) ?? [];
        const targets = cfByCol.get(c + 1) ?? [];
        for (const src of sources) {
          for (const tgt of targets) {
            edges.push({
              id: `cf-${child.flowId}:${src.stepId}->${tgt.stepId}`,
              source: `cf-step-${child.flowId}-${src.stepId}`,
              target: `cf-step-${child.flowId}-${tgt.stepId}`,
              animated: src.status === "running" || tgt.status === "running",
              type: "smoothstep",
              style: {
                stroke: tgt.hasError
                  ? "#f87171"
                  : src.status === "running" || tgt.status === "running"
                    ? "#60a5fa"
                    : "#52525b",
                strokeWidth: 1.5,
              },
            });
          }
        }
      }

      // Edge from parent's last step to child flow
      if (laid.length > 0) {
        const lastColSteps = byCol.get(maxCol);
        if (lastColSteps && lastColSteps.length > 0) {
          edges.push({
            id: `parent->${child.flowId}`,
            source: lastColSteps[0]!.stepId,
            target: cfNodeId,
            animated: child.status === "running",
            type: "smoothstep",
            style: {
              stroke: "#6d28d9",
              strokeWidth: 2,
              strokeDasharray: "4 3",
            },
          });
        }
      }

      // Connect sequential child flows
      if (i > 0) {
        const prev = childFlows[i - 1]!;
        edges.push({
          id: `cf-${prev.flowId}->cf-${child.flowId}`,
          source: `cf-${prev.flowId}`,
          target: `cf-${child.flowId}`,
          animated: child.status === "running",
          type: "smoothstep",
          style: {
            stroke: "#3f3f46",
            strokeWidth: 1.5,
            strokeDasharray: "6 4",
          },
        });
      }

      childX += cfWidth + NODE_GAP_X;
    }
  }

  return { nodes, edges };
}

// ─────────────────────────────────────────────────────────────────
// Custom node components
// ─────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<
  StepData["status"],
  { bg: string; border: string; dot: string; glow: string }
> = {
  success: {
    bg: "bg-(--devtools-ok-soft)",
    border: "border-(--devtools-ok-soft)",
    dot: "bg-(--devtools-ok)",
    glow: "",
  },
  error: {
    bg: "bg-(--devtools-danger-soft)",
    border: "border-(--devtools-danger-soft)",
    dot: "bg-(--devtools-danger)",
    glow: "shadow-[0_0_12px_rgba(248,113,113,0.15)]",
  },
  running: {
    bg: "bg-(--devtools-blue-soft)",
    border: "border-(--devtools-blue-line)",
    dot: "bg-(--devtools-blue)",
    glow: "shadow-[0_0_12px_rgba(96,165,250,0.15)]",
  },
  slow: {
    bg: "bg-(--devtools-warn-soft)",
    border: "border-(--devtools-warn-soft)",
    dot: "bg-(--devtools-warn)",
    glow: "",
  },
};

const StepNode = memo(function StepNode({
  data,
}: NodeProps<Node<StepNodeData>>) {
  const colors = STATUS_COLORS[data.status];
  const ringClass = data.selected ? "ring-2 ring-zinc-300/60" : "";
  const shortModel = data.model
    ? data.model.replace(/^[^/]+\//, "").slice(0, 20)
    : null;

  return (
    <div
      className={`rounded-lg border ${colors.bg} ${colors.border} ${ringClass} ${colors.glow} cursor-pointer transition-shadow hover:shadow-lg`}
      style={{ width: data.width, minHeight: NODE_H }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-zinc-600 !w-1.5 !h-1.5 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-zinc-600 !w-1.5 !h-1.5 !border-0"
      />

      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${colors.dot} shrink-0 ${
              data.status === "running" ? "animate-pulse" : ""
            }`}
          />
          <span className="text-xs font-medium text-zinc-200 truncate">
            {data.stepLabel}
          </span>
          {data.traceCount > 1 && (
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {data.traceCount}x
            </span>
          )}
        </div>

        {shortModel && (
          <div className="mb-1.5">
            <span className="text-[10px] text-zinc-500 font-mono bg-zinc-800/60 rounded px-1 py-0.5">
              {shortModel}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2.5 text-[10px] text-zinc-400 tabular-nums">
          <span>{fmt(data.totalDurationMs, "ms")}</span>
          {data.totalTokens > 0 && <span>{fmt(data.totalTokens, "tok")}</span>}
          {data.totalCost > 0 && (
            <span className="text-(--devtools-ok)">{fmt(data.totalCost, "$")}</span>
          )}
        </div>

        {data.hasError && data.errorMessage && (
          <div className="mt-1 text-[9px] text-(--devtools-danger) truncate">
            {data.errorMessage.slice(0, 40)}
          </div>
        )}
      </div>
    </div>
  );
});

// Child flow group node — rendered as a nested container within the waterfall
const CF_STATUS: Record<
  "success" | "error" | "running",
  { border: string; bg: string; badge: string }
> = {
  success: {
    border: "border-(--devtools-iris-line)",
    bg: "bg-(--devtools-iris-soft)",
    badge: "bg-(--devtools-iris-soft) text-(--devtools-iris)",
  },
  error: {
    border: "border-(--devtools-danger-soft)",
    bg: "bg-(--devtools-danger-soft)",
    badge: "bg-(--devtools-danger-soft) text-(--devtools-danger)",
  },
  running: {
    border: "border-(--devtools-blue-line)",
    bg: "bg-(--devtools-blue-soft)",
    badge: "bg-(--devtools-blue-soft) text-(--devtools-blue)",
  },
};

const ChildFlowNode = memo(function ChildFlowNode({
  data,
}: NodeProps<Node<ChildFlowNodeData>>) {
  const styles = CF_STATUS[data.status];

  return (
    <div
      className={`rounded-lg border-2 ${styles.border} ${styles.bg} cursor-pointer`}
      style={{ width: data.width, height: data.height }}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span
          className={`text-[9px] font-semibold uppercase tracking-wider ${styles.badge} rounded px-1 py-0.5`}
        >
          Sub-flow
        </span>
        <span className="text-[10px] font-mono text-zinc-300 truncate font-medium">
          {data.name}
        </span>
        <div className="ml-auto flex items-center gap-1.5 text-[9px] text-zinc-500 tabular-nums">
          <span>{fmt(data.durationMs, "ms")}</span>
          {data.totalTokens > 0 && <span>{fmt(data.totalTokens, "tok")}</span>}
          {data.totalCost > 0 && (
            <span className="text-(--devtools-ok)">{fmt(data.totalCost, "$")}</span>
          )}
        </div>
      </div>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-(--devtools-iris) !w-2 !h-2 !border-0 !-top-1"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-(--devtools-iris) !w-2 !h-2 !border-0 !-bottom-1"
      />
    </div>
  );
});

// Smaller step node used inside child flow groups
const ChildStepNode = memo(function ChildStepNode({
  data,
}: NodeProps<Node<StepNodeData>>) {
  const colors = STATUS_COLORS[data.status];
  const ringClass = data.selected ? "ring-2 ring-zinc-300/60" : "";

  return (
    <div
      className={`rounded border ${colors.bg} ${colors.border} ${ringClass} cursor-pointer hover:brightness-110 transition-all`}
      style={{ width: data.width, height: CF_STEP_H }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-zinc-600 !w-1 !h-1 !border-0"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!bg-zinc-600 !w-1 !h-1 !border-0"
      />

      <div className="px-2 py-1">
        <div className="flex items-center gap-1 mb-0.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${colors.dot} shrink-0 ${data.status === "running" ? "animate-pulse" : ""}`}
          />
          <span className="text-[9px] font-medium text-zinc-200 truncate">
            {data.stepLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[8px] text-zinc-500 tabular-nums">
          <span>{fmt(data.totalDurationMs, "ms")}</span>
          {data.totalCost > 0 && (
            <span className="text-(--devtools-ok)">{fmt(data.totalCost, "$")}</span>
          )}
        </div>
      </div>
    </div>
  );
});

const nodeTypes = {
  stepNode: StepNode,
  childFlowNode: ChildFlowNode,
  childStepNode: ChildStepNode,
};

// ─────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────

export function FlowWaterfall({
  traces,
  allSessionTraces,
  onSelectTrace,
  onSelectFlow,
  selectedTraceId,
  flowNameMap,
  className,
}: FlowWaterfallProps) {
  // Determine the parent flowId from these traces
  const parentFlowId = useMemo(() => {
    const flowIds = new Set(traces.map((t) => t.flowId).filter(Boolean));
    return flowIds.size === 1 ? [...flowIds][0]! : null;
  }, [traces]);

  const { nodes, edges } = useMemo(() => {
    const sorted = [...traces].sort((a, b) => a.startedAt - b.startedAt);
    const steps = buildSteps(sorted);
    const laid = layoutSteps(steps);

    // Find child flows if we have a parent flowId and session traces
    const childFlows =
      parentFlowId && allSessionTraces
        ? findChildFlows(parentFlowId, allSessionTraces, flowNameMap)
        : [];

    return buildGraph(laid, childFlows, selectedTraceId);
  }, [traces, allSessionTraces, selectedTraceId, parentFlowId, flowNameMap]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === "stepNode" || node.type === "childStepNode") {
        const data = node.data as StepNodeData;
        onSelectTrace(data.firstTraceId);
      } else if (node.type === "childFlowNode" && onSelectFlow) {
        const data = node.data as ChildFlowNodeData;
        onSelectFlow(data.flowId);
      }
    },
    [onSelectTrace, onSelectFlow],
  );

  if (nodes.length === 0) {
    return (
      <div
        className={`h-[300px] flex items-center justify-center text-sm text-zinc-500 ${className ?? ""}`}
      >
        No flow steps to display
      </div>
    );
  }

  // Auto-size height based on whether we have child flows
  const hasChildren = nodes.some((n) => n.type === "childFlowNode");
  const height = hasChildren ? 420 : 300;

  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-950 ${className ?? ""}`}
      style={{ height }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
      >
        <Background color="#27272a" gap={20} />
        <Controls
          showInteractive={false}
          className="!bg-zinc-900 !border-zinc-700 !shadow-none [&>button]:!bg-zinc-800 [&>button]:!border-zinc-700 [&>button]:!text-zinc-400 [&>button:hover]:!bg-zinc-700"
        />
      </ReactFlow>
    </div>
  );
}
