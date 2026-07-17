import type {
  Trace,
  MemoryEventData,
  CompactEventData,
  BudgetSnapshotData,
  AgentEventData,
  JudgeEventData,
  ToolEventData,
  DelegateEventData,
  CorrelatedEvent,
  SessionInfo,
} from "@/types";

// ─────────────────────────────────────────────────────────────────
// View mode
// ─────────────────────────────────────────────────────────────────

export type ViewMode = "flat" | "session" | "flow";

// ─────────────────────────────────────────────────────────────────
// Formatting helpers
// ─────────────────────────────────────────────────────────────────

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "...";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatCost(cost: number): string {
  if (cost < 0.001) return `$${cost.toFixed(6)}`;
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

// ─────────────────────────────────────────────────────────────────
// Role display constants
// ─────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<string, string> = {
  resolve: "resolve",
  "agent-step": "step",
  generate: "generate",
};

export const ROLE_COLORS: Record<string, string> = {
  resolve: "text-zinc-500",
  "agent-step": "text-indigo-400",
  generate: "text-cyan-400",
};

export const ROLE_LINE_COLORS: Record<string, string> = {
  resolve: "border-zinc-700",
  "agent-step": "border-indigo-500/40",
  generate: "border-cyan-500/40",
};

export const ROLE_DOT_COLORS: Record<string, string> = {
  resolve: "bg-zinc-600",
  "agent-step": "bg-indigo-500",
  generate: "bg-cyan-500",
};

// ─────────────────────────────────────────────────────────────────
// Filtering
// ─────────────────────────────────────────────────────────────────

export function filterTraces(
  traces: Trace[],
  sessionFilter: string | null,
  promptFilter: string | null,
  statusFilter: string | null,
  searchQuery: string,
): Trace[] {
  let filtered = traces;
  if (sessionFilter)
    filtered = filtered.filter((t) => t.sessionId === sessionFilter);
  if (promptFilter)
    filtered = filtered.filter((t) => t.promptId === promptFilter);
  if (statusFilter)
    filtered = filtered.filter((t) => t.status === statusFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(
      (t) =>
        (t.promptId ?? "").toLowerCase().includes(q) ||
        t.traceId.toLowerCase().includes(q) ||
        t.model.toLowerCase().includes(q),
    );
  }
  return filtered;
}

// ─────────────────────────────────────────────────────────────────
// Session grouping
// ─────────────────────────────────────────────────────────────────

export interface SessionGroup {
  sessionId: string;
  traces: Trace[];
  startedAt: number;
  endedAt: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCost: number;
  hasError: boolean;
  isRunning: boolean;
}

export function buildSessionGroups(traces: Trace[]): {
  groups: SessionGroup[];
  ungrouped: Trace[];
} {
  const bySession = new Map<string, Trace[]>();
  const ungrouped: Trace[] = [];

  for (const t of traces) {
    if (t.sessionId) {
      let list = bySession.get(t.sessionId);
      if (!list) {
        list = [];
        bySession.set(t.sessionId, list);
      }
      list.push(t);
    } else {
      ungrouped.push(t);
    }
  }

  const groups: SessionGroup[] = [];
  for (const [sessionId, sessionTraces] of bySession) {
    sessionTraces.sort((a, b) => a.startedAt - b.startedAt);
    const startedAt = sessionTraces[0]!.startedAt;
    const endedAt = Math.max(
      ...sessionTraces.map((t) => t.startedAt + (t.durationMs ?? 0)),
    );
    const totalTokens = sessionTraces.reduce(
      (sum, t) => sum + (t.result?.usage?.totalTokens ?? 0),
      0,
    );
    const totalCost = sessionTraces.reduce(
      (sum, t) => sum + (t.result?.cost ?? 0),
      0,
    );
    const hasError = sessionTraces.some((t) => t.status === "error");
    const isRunning = sessionTraces.some((t) => t.status === "running");

    groups.push({
      sessionId,
      traces: sessionTraces,
      startedAt,
      endedAt,
      totalDurationMs: endedAt - startedAt,
      totalTokens,
      totalCost,
      hasError,
      isRunning,
    });
  }

  groups.sort((a, b) => b.startedAt - a.startedAt);
  return { groups, ungrouped };
}

// ─────────────────────────────────────────────────────────────────
// Flow grouping — flows are ALWAYS grouped, regardless of view mode
// ─────────────────────────────────────────────────────────────────

export interface FlowGroup {
  flowId: string;
  parentFlowId?: string;
  name: string;
  traces: Trace[];
  stepGroups: Map<string, { stepLabel: string; traces: Trace[] }>;
  children: FlowGroup[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
  totalTokens: number;
  totalCost: number;
  hasError: boolean;
  isRunning: boolean;
}

export function buildFlowGroup(
  flowId: string,
  flowTraces: Trace[],
  nameMap?: Map<string, string>,
): FlowGroup {
  flowTraces.sort((a, b) => a.startedAt - b.startedAt);
  const now = Date.now();

  const stepGroups = new Map<string, { stepLabel: string; traces: Trace[] }>();
  for (const t of flowTraces) {
    const key = t.stepId ?? "_ungrouped";
    let group = stepGroups.get(key);
    if (!group) {
      group = { stepLabel: t.stepLabel ?? t.promptId ?? key, traces: [] };
      stepGroups.set(key, group);
    }
    group.traces.push(t);
  }

  const startedAt = flowTraces[0]!.startedAt;
  const endedAt = Math.max(
    ...flowTraces.map((t) =>
      t.status === "running" ? now : t.startedAt + (t.durationMs ?? 0),
    ),
  );
  const totalTokens = flowTraces.reduce(
    (sum, t) => sum + (t.result?.usage?.totalTokens ?? 0),
    0,
  );
  const totalCost = flowTraces.reduce(
    (sum, t) => sum + (t.result?.cost ?? 0),
    0,
  );
  const name =
    nameMap?.get(flowId) ?? flowId.replace(/^flow-\d+-[a-z0-9]+$/, "flow");
  const parentFlowId = flowTraces.find((t) => t.parentFlowId)?.parentFlowId;

  return {
    flowId,
    parentFlowId,
    name,
    traces: flowTraces,
    stepGroups,
    children: [],
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    totalTokens,
    totalCost,
    hasError: flowTraces.some((t) => t.status === "error"),
    isRunning: flowTraces.some((t) => t.status === "running"),
  };
}

export function buildFlowGroups(
  traces: Trace[],
  nameMap?: Map<string, string>,
): { flowGroups: FlowGroup[]; ungrouped: Trace[] } {
  const byFlow = new Map<string, Trace[]>();
  const ungrouped: Trace[] = [];

  for (const t of traces) {
    if (t.flowId) {
      let list = byFlow.get(t.flowId);
      if (!list) {
        list = [];
        byFlow.set(t.flowId, list);
      }
      list.push(t);
    } else {
      ungrouped.push(t);
    }
  }

  const allGroups = new Map<string, FlowGroup>();
  for (const [flowId, flowTraces] of byFlow) {
    allGroups.set(flowId, buildFlowGroup(flowId, flowTraces, nameMap));
  }

  // Create synthetic parent groups for parentFlowIds that have no direct traces.
  for (const group of [...allGroups.values()]) {
    if (group.parentFlowId && !allGroups.has(group.parentFlowId)) {
      const syntheticParent: FlowGroup = {
        flowId: group.parentFlowId,
        name: nameMap?.get(group.parentFlowId) ?? group.parentFlowId,
        traces: [],
        stepGroups: new Map(),
        children: [],
        startedAt: group.startedAt,
        endedAt: group.endedAt,
        durationMs: 0,
        totalTokens: 0,
        totalCost: 0,
        hasError: false,
        isRunning: false,
      };
      allGroups.set(group.parentFlowId, syntheticParent);
    }
  }

  const rootGroups: FlowGroup[] = [];
  for (const group of allGroups.values()) {
    if (group.parentFlowId && allGroups.has(group.parentFlowId)) {
      allGroups.get(group.parentFlowId)!.children.push(group);
    } else {
      rootGroups.push(group);
    }
  }

  for (const group of allGroups.values()) {
    group.children.sort((a, b) => a.startedAt - b.startedAt);
  }

  rootGroups.sort((a, b) => a.startedAt - b.startedAt);
  return { flowGroups: rootGroups, ungrouped };
}

// ─────────────────────────────────────────────────────────────────
// Mixed chronological list (for flat mode)
// ─────────────────────────────────────────────────────────────────

export type ListItem =
  | { kind: "trace"; trace: Trace }
  | { kind: "flow"; group: FlowGroup };

export function buildMixedChronological(
  traces: Trace[],
  nameMap?: Map<string, string>,
): ListItem[] {
  const { flowGroups, ungrouped } = buildFlowGroups(traces, nameMap);
  const items: ListItem[] = [];
  for (const group of flowGroups) items.push({ kind: "flow", group });
  for (const trace of ungrouped) items.push({ kind: "trace", trace });
  // Sort by startedAt descending (most recent first)
  items.sort((a, b) => {
    const aTime = a.kind === "flow" ? a.group.startedAt : a.trace.startedAt;
    const bTime = b.kind === "flow" ? b.group.startedAt : b.trace.startedAt;
    return bTime - aTime;
  });
  return items;
}

// ─────────────────────────────────────────────────────────────────
// Correlated events
// ─────────────────────────────────────────────────────────────────

export function getCorrelatedEventsFromState(
  traceId: string,
  memoryEvents: MemoryEventData[],
  compactEvents: CompactEventData[],
  budgetSnapshots: BudgetSnapshotData[],
  agentEvents: AgentEventData[],
  judgeEvents: JudgeEventData[],
  toolEvents: ToolEventData[] = [],
  delegateEvents: DelegateEventData[] = [],
): CorrelatedEvent[] {
  const events: CorrelatedEvent[] = [];

  for (const e of memoryEvents) {
    if (e.traceId !== traceId) continue;
    // Memory events are a discriminated union — collapse field access to a
    // flat record where every variant-only field is optional. Reads have
    // resultCount/durationMs/query; writes have operation. memoryId/type
    // are shared.
    const m = e as Partial<{
      operation: string;
      resultCount: number;
      durationMs: number;
      query: string;
      memoryType: "working" | "episodic" | "semantic" | "block";
    }>;
    events.push({
      id: `mem-${events.length}`,
      eventType: e.type,
      timestamp: e.timestamp,
      data: {
        memoryId: e.memoryId,
        operation: m.operation,
        _kind: e._kind,
        resultCount: m.resultCount,
        durationMs: m.durationMs,
        query: m.query,
        memoryType: m.memoryType,
      },
    });
  }
  for (const e of compactEvents) {
    if (e.traceId !== traceId) continue;
    const c = e as Partial<{
      reason: string;
      inputTokens: number;
      inputMessageCount: number;
      outputTokens: number;
      compressionRatio: number;
      durationMs: number;
      summaryPreview: string;
    }>;
    events.push({
      id: `compact-${events.length}`,
      eventType: e.type,
      timestamp: e.timestamp,
      data: {
        _kind: e._kind,
        reason: c.reason,
        inputTokens: c.inputTokens,
        inputMessageCount: c.inputMessageCount,
        outputTokens: c.outputTokens,
        compressionRatio: c.compressionRatio,
        durationMs: c.durationMs,
        summaryPreview: c.summaryPreview,
      },
    });
  }
  for (const e of budgetSnapshots) {
    if (e.traceId !== traceId) continue;
    events.push({
      id: `budget-${events.length}`,
      eventType: "budget:check",
      timestamp: e.timestamp,
      data: {
        used: e.used,
        available: e.available,
        level: e.level,
        breakdown: e.breakdown,
      },
    });
  }
  for (const e of agentEvents) {
    if (e.traceId !== traceId) continue;
    const a = e as Partial<{
      boardId: string;
      fieldsChanged: string[];
      handoffId: string;
      inputSize: number;
      outputSize: number;
      fromAgent: string;
      toAgent: string;
      summary: string;
      input: unknown;
      output: unknown;
      snapshot: Record<string, unknown>;
    }>;
    events.push({
      id: `agent-${events.length}`,
      eventType: e.type,
      timestamp: e.timestamp,
      data: {
        _kind: e._kind,
        boardId: a.boardId,
        fieldsChanged: a.fieldsChanged,
        handoffId: a.handoffId,
        inputSize: a.inputSize,
        outputSize: a.outputSize,
        fromAgent: a.fromAgent,
        toAgent: a.toAgent,
        summary: a.summary,
        input: a.input,
        output: a.output,
        snapshot: a.snapshot,
      },
    });
  }
  for (const e of judgeEvents) {
    if (e.traceId !== traceId) continue;
    events.push({
      id: `judge-${events.length}`,
      eventType: "judge:result",
      timestamp: e.timestamp,
      data: { metricId: e.metricId, score: e.score, reasoning: e.reasoning },
    });
  }
  for (const e of toolEvents) {
    if (e.traceId !== traceId) continue;
    const t = e as Partial<{
      toolCallId: string;
      toolName: string;
      args: unknown;
      durationMs: number;
      result: unknown;
      error: string;
      estimated: boolean;
      approvalId: string;
      approved: boolean;
      reason: string;
      input: unknown;
    }>;
    events.push({
      id: `tool-${events.length}`,
      eventType: e.type,
      timestamp: e.timestamp,
      data: {
        _kind: e._kind,
        toolCallId: t.toolCallId,
        toolName: t.toolName,
        args: t.args,
        durationMs: t.durationMs,
        result: t.result,
        error: t.error,
        estimated: t.estimated,
        approvalId: t.approvalId,
        approved: t.approved,
        reason: t.reason,
        input: t.input,
      },
    });
  }

  for (const e of delegateEvents) {
    if (e.traceId !== traceId) continue;
    const d = e as Partial<{
      delegateId: string;
      handoffId: string;
      inputSize: number;
      outputSize: number;
      durationMs: number;
      input: unknown;
      output: unknown;
    }>;
    events.push({
      id: `delegate-${events.length}`,
      eventType: e.type,
      timestamp: e.timestamp,
      data: {
        _kind: e._kind,
        delegateId: d.delegateId,
        handoffId: d.handoffId,
        inputSize: d.inputSize,
        outputSize: d.outputSize,
        durationMs: d.durationMs,
        input: d.input,
        output: d.output,
      },
    });
  }

  events.sort((a, b) => a.timestamp - b.timestamp);
  return events;
}

// ─────────────────────────────────────────────────────────────────
// Anomaly helpers
// ─────────────────────────────────────────────────────────────────

export interface TraceAnomalies {
  durationP90: number;
  avgCostByPrompt: Map<string, number>;
}

export function computeTraceAnomalies(traces: Trace[]): TraceAnomalies {
  const completedDurations = traces
    .filter((t) => t.status === "success" && t.durationMs != null)
    .map((t) => t.durationMs!)
    .sort((a, b) => a - b);

  const durationP90 =
    completedDurations.length > 0
      ? completedDurations[Math.floor(completedDurations.length * 0.9)]!
      : Infinity;

  const costByPrompt = new Map<string, number[]>();
  for (const t of traces) {
    if (!t.promptId || t.result?.cost == null) continue;
    let list = costByPrompt.get(t.promptId);
    if (!list) {
      list = [];
      costByPrompt.set(t.promptId, list);
    }
    list.push(t.result.cost);
  }

  const avgCostByPrompt = new Map<string, number>();
  for (const [promptId, costs] of costByPrompt) {
    avgCostByPrompt.set(
      promptId,
      costs.reduce((a, b) => a + b, 0) / costs.length,
    );
  }

  return { durationP90, avgCostByPrompt };
}
