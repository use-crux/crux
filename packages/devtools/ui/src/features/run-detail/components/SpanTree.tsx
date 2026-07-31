import {
  useDeferredValue,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
  type UIEvent as ReactUIEvent,
} from "react";
import { RowErrorBoundary } from "@/devtools/shell/SectionBoundary";
import {
  ChevronRight,
  ChevronDown,
  Users,
  GitBranch,
  Layers,
  Bot,
  CheckCircle,
  Sparkles,
  Search,
  List,
  BarChart3,
  ArrowRightLeft,
  ArrowLeftRight,
  Network,
  AlertTriangle,
} from "lucide-react";
import type { SpanNode } from "@/features/observability/lib/span-tree";
import {
  flatStatuses,
  nodesOnFailurePath,
} from "@/features/run-detail/lib/triage";
import { TriageMinimap } from "./TriageMinimap";
import { RedactionDot } from "./RedactionEvidence";

// Past this many spans the structure scroll gets a status minimap for
// orientation (design `dx-workbench` — "appears past ~80 visible rows").
const MINIMAP_THRESHOLD = 80;

type ViewMode = "tree" | "timeline";

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return "";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(2)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number | undefined): string {
  if (tokens == null) return "";
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${tokens}`;
}

// Width of the fixed label column in the Timeline layout (design
// `StructureTimeline` — the span name column the time axis hangs off).
// Shared by the waterfall rows and the ruler so ticks align with bars.
const TIMELINE_LABEL_W = 200;

// ---------------------------------------------------------------------------
// Flatten tree into visible list respecting collapsed state
// ---------------------------------------------------------------------------

function flattenVisible(node: SpanNode, collapsed: Set<string>): SpanNode[] {
  const result: SpanNode[] = [node];
  if (!collapsed.has(node.id) && node.children.length > 0) {
    for (const child of node.children) {
      result.push(...flattenVisible(child, collapsed));
    }
  }
  return result;
}

function collectAll(node: SpanNode): SpanNode[] {
  const result: SpanNode[] = [node];
  for (const child of node.children) {
    result.push(...collectAll(child));
  }
  return result;
}

/**
 * The chain of node ids from the root down to (and including) `id`, or
 * null if not found. Used to auto-expand the ancestors of a deep-linked
 * span so its row is visible.
 */
function pathToNode(
  node: SpanNode,
  id: string,
  acc: string[] = [],
): string[] | null {
  const next = [...acc, node.id];
  if (node.id === id) return next;
  for (const child of node.children) {
    const found = pathToNode(child, id, next);
    if (found) return found;
  }
  return null;
}

function filterTree(node: SpanNode, query: string): SpanNode | null {
  const lower = query.toLowerCase();
  const matchesSelf = node.label.toLowerCase().includes(lower);
  const filteredChildren: SpanNode[] = [];
  for (const child of node.children) {
    const filtered = filterTree(child, query);
    if (filtered) filteredChildren.push(filtered);
  }
  if (matchesSelf || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Collapse redundant FLOW > STEP pairs that share label + metrics
//
// A flow with a single step child whose label and metrics mirror the flow
// exactly is just a wrapper — render the step's children directly under the
// flow rather than showing two visually identical rows.
// ---------------------------------------------------------------------------

function isRedundantStepChild(flow: SpanNode, step: SpanNode): boolean {
  if (flow.kind !== "flow" || step.kind !== "step") return false;
  if (flow.label !== step.label) return false;
  if ((flow.tokens ?? 0) !== (step.tokens ?? 0)) return false;
  if ((flow.durationMs ?? 0) !== (step.durationMs ?? 0)) return false;
  const flowCost = flow.cost ?? 0;
  const stepCost = step.cost ?? 0;
  return Math.abs(flowCost - stepCost) < 1e-6;
}

function collapseRedundantSteps(node: SpanNode): SpanNode {
  const newChildren: SpanNode[] = [];
  for (const child of node.children) {
    const collapsedChild = collapseRedundantSteps(child);
    if (
      node.kind === "flow" &&
      node.children.length === 1 &&
      isRedundantStepChild(node, child)
    ) {
      // Splice the step's (already-collapsed) children directly under the flow
      newChildren.push(
        ...collapsedChild.children.map((c) => ({ ...c, depth: c.depth - 1 })),
      );
    } else {
      newChildren.push(collapsedChild);
    }
  }
  return { ...node, children: newChildren };
}

// ---------------------------------------------------------------------------
// Kind icon mapping
// ---------------------------------------------------------------------------

function KindIcon({ node }: { node: SpanNode }) {
  const size = 12;
  switch (node.kind) {
    case "session":
      return <Users size={size} className="text-(--devtools-fg-muted) shrink-0" />;
    case "flow":
      return <GitBranch size={size} className="text-(--devtools-iris) shrink-0" />;
    case "step":
      return <Layers size={size} className="text-(--devtools-iris) shrink-0" />;
    case "handoff":
      return (
        <ArrowRightLeft size={size} className="text-(--devtools-warn) shrink-0" />
      );
    case "composition":
      if (node.composition?.kind === "swarm") {
        return (
          <ArrowLeftRight size={size} className="text-(--devtools-warn) shrink-0" />
        );
      }
      return <Network size={size} className="text-fuchsia-400 shrink-0" />;
    case "trace": {
      const role = node.trace?.role;
      if (role === "agent-step")
        return <Bot size={size} className="text-(--devtools-iris) shrink-0" />;
      if (role === "resolve")
        return (
          <CheckCircle size={size} className="text-(--devtools-fg-muted) shrink-0" />
        );
      return <Sparkles size={size} className="text-(--devtools-crux) shrink-0" />;
    }
    default:
      return <Sparkles size={12} className="text-(--devtools-fg-faint) shrink-0" />;
  }
}

// ---------------------------------------------------------------------------
// Border color for selected state
// ---------------------------------------------------------------------------

function kindBorderColor(kind: SpanNode["kind"]): string {
  switch (kind) {
    case "session":
      return "border-l-(--devtools-fg-muted)";
    case "flow":
      return "border-l-violet-400";
    case "step":
      return "border-l-indigo-400";
    case "trace":
      return "border-l-cyan-400";
    case "handoff":
      return "border-l-orange-400";
    case "composition":
      return "border-l-fuchsia-400";
  }
}

// ---------------------------------------------------------------------------
// Status dot
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: SpanNode["status"] }) {
  const base = "w-1.5 h-1.5 rounded-full shrink-0";
  switch (status) {
    case "success":
      return <span className={`${base} bg-(--devtools-ok)`} />;
    case "error":
      return <span className={`${base} bg-(--devtools-danger)`} />;
    case "running":
      return <span className={`${base} bg-(--devtools-blue) animate-pulse`} />;
    case "stale":
      return <span className={`${base} bg-(--devtools-warn)`} />;
  }
}

// ---------------------------------------------------------------------------
// SpanRow
// ---------------------------------------------------------------------------

interface SpanRowProps {
  node: SpanNode;
  isSelected: boolean;
  isCollapsed: boolean;
  /** This span's turn explanation carries a warning signal (stale-used,
   *  dropped, fallback, …). Renders a badge; selecting it opens Explain. */
  warning?: boolean;
  onSelect: (id: string) => void;
  /** Chevron toggle — opens or closes the node. */
  onToggle: (id: string) => void;
  /** Row click — opens (never closes) the node. */
  onExpand: (id: string) => void;
  /** Run timeline bounds — drive the per-row micro waterfall bar. */
  timelineStart: number;
  timelineEnd: number;
}

function SpanRow({
  node,
  isSelected,
  isCollapsed,
  warning,
  onSelect,
  onToggle,
  onExpand,
  timelineStart,
  timelineEnd,
}: SpanRowProps) {
  const hasChildren = node.children.length > 0;
  const semanticKind = semanticKindFor(node);

  // Per-row micro waterfall (design `StructureTree`): the span's position +
  // duration on the run's timeline, drawn as a thin bar beneath the row.
  const range = timelineEnd - timelineStart;
  const barLeft =
    range > 0
      ? Math.max(0, ((node.startedAt - timelineStart) / range) * 100)
      : 0;
  const barWidth =
    range > 0 && node.durationMs != null
      ? Math.max((node.durationMs / range) * 100, 1)
      : 1;
  const accent = kindHexColor(semanticKind);

  return (
    <div>
      <button
        type="button"
        data-span-id={node.id}
        className={`
        flex items-center w-full text-left text-[11px] h-7 group cursor-pointer
        ${isSelected ? `bg-(--devtools-bg-muted) border-l-2 ${kindBorderColor(node.kind)}` : "border-l-2 border-l-transparent hover:bg-(--devtools-bg-muted)/50"}
      `}
        style={{ paddingLeft: node.depth * 20 }}
        onClick={() => {
          onSelect(node.id);
          if (hasChildren) onExpand(node.id);
        }}
      >
        {/* Chevron — toggles open/closed; stops propagation so the row's
          open-only click handler doesn't immediately re-open it. */}
        <span
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            onToggle(node.id);
          }}
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight size={12} className="text-(--devtools-fg-faint)" />
            ) : (
              <ChevronDown size={12} className="text-(--devtools-fg-faint)" />
            )
          ) : null}
        </span>

        {/* Status dot */}
        <span className="mx-1 flex items-center">
          <StatusDot status={node.status} />
        </span>

        {/* Kind chip (colored, design pattern) */}
        <span
          className="mr-2 shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.06em]"
          style={{
            color: kindHexColor(semanticKind),
            background: "var(--devtools-bg, transparent)",
            boxShadow: `inset 0 0 0 1px ${kindHexColor(semanticKind)}`,
          }}
        >
          {semanticKind}
        </span>

        {/* Label */}
        <span
          className={`truncate min-w-0 flex-1 ${node.kind === "handoff" ? "text-(--devtools-warn) italic" : node.composition?.kind === "swarm" ? "text-(--devtools-warn)" : node.kind === "composition" ? "text-fuchsia-300" : "text-(--devtools-fg)"}`}
        >
          {node.label}
        </span>

        {(node.redactionLocal ||
          (isCollapsed && node.redactionDescendant)) && (
          <span className="ml-1.5 flex shrink-0 items-center">
            <RedactionDot
              descendant={!node.redactionLocal && node.redactionDescendant}
            />
          </span>
        )}

        {/* Swarm handoff path badge */}
        {node.kind === "composition" &&
          node.composition?.kind === "swarm" &&
          node.composition.handoffPath && (
            <span className="text-[9px] text-(--devtools-warn) tabular-nums shrink-0 ml-1.5 truncate max-w-[200px]">
              {node.composition.handoffPath.join(" → ")}
            </span>
          )}

        {/* Swarm hop count badge */}
        {node.kind === "composition" &&
          node.composition?.kind === "swarm" &&
          node.composition.handoffCount != null && (
            <span className="text-[9px] text-(--devtools-warn) tabular-nums shrink-0 ml-1">
              {node.composition.handoffCount}{" "}
              {node.composition.handoffCount === 1 ? "hop" : "hops"}
            </span>
          )}

        {/* Composition agreement badge */}
        {node.kind === "composition" && node.composition?.agreement != null && (
          <span className="text-[9px] text-fuchsia-400/70 tabular-nums shrink-0 ml-1.5">
            {Math.round(node.composition.agreement * 100)}% agree
          </span>
        )}

        {/* Handoff data sizing (ghost row) */}
        {node.kind === "handoff" && node.delegate && (
          <span className="text-[9px] text-(--devtools-warn) tabular-nums shrink-0 ml-1.5">
            {node.delegate.inputSize != null && node.delegate.outputSize != null
              ? `${node.delegate.inputSize}B → ${node.delegate.outputSize}B`
              : ""}
            {node.delegate.handoffId ? ` · ${node.delegate.handoffId}` : ""}
          </span>
        )}

        {/* Model badge */}
        {node.model && (
          <span className="text-[9px] bg-(--devtools-bg-muted) text-(--devtools-fg-muted) rounded px-1 ml-1.5 shrink-0">
            {node.model}
          </span>
        )}

        {/* Turn explanation warning — selecting the span opens Explain */}
        {warning && (
          <span
            className="ml-1.5 inline-flex shrink-0 items-center gap-[3px] rounded-[3px] px-1 text-[9px]"
            style={{
              color: "var(--devtools-warn)",
              background: "var(--devtools-warn-soft)",
              boxShadow: "inset 0 0 0 1px var(--devtools-warn-line)",
            }}
            title="Turn explanation has a warning signal — open Explain"
          >
            ✦ explain
          </span>
        )}

        {/* Dropped context warning */}
        {node.trace?.inspect?.droppedContexts?.length != null &&
          node.trace.inspect.droppedContexts.length > 0 && (
            <span
              className="text-[9px] text-(--devtools-warn) ml-1 shrink-0"
              title={`${node.trace.inspect.droppedContexts.length} context(s) dropped`}
            >
              ⚠
            </span>
          )}

        {/* Budget warning */}
        {node.trace?.inspect?.totalTokens != null &&
          node.trace.inspect.tokenBudget != null &&
          node.trace.inspect.totalTokens >
            node.trace.inspect.tokenBudget * 0.9 && (
            <span
              className="text-[9px] text-(--devtools-danger) ml-1 shrink-0"
              title={`Token usage: ${node.trace.inspect.totalTokens}/${node.trace.inspect.tokenBudget} (${Math.round((node.trace.inspect.totalTokens / node.trace.inspect.tokenBudget) * 100)}%)`}
            >
              ●
            </span>
          )}

        {/* Tokens */}
        {node.tokens != null && (
          <span className="text-(--devtools-fg-faint) tabular-nums ml-2 shrink-0">
            {formatTokens(node.tokens)}
          </span>
        )}

        {/* Duration — or a live "···" for an in-flight span with no end yet. */}
        {node.durationMs != null ? (
          <span className="text-(--devtools-fg-faint) tabular-nums ml-2 shrink-0">
            {formatDuration(node.durationMs)}
          </span>
        ) : (
          node.status === "running" && (
            <span
              className="text-(--devtools-crux) tabular-nums ml-2 shrink-0 animate-pulse"
              title="in flight"
            >
              ···
            </span>
          )
        )}

        {/* Cost */}
        {node.cost != null && (
          <span className="text-(--devtools-fg-faint) tabular-nums ml-2 shrink-0">
            {formatCost(node.cost)}
          </span>
        )}

        <span className="w-2 shrink-0" />
      </button>
      {/* Micro waterfall — the span's slice of the run timeline. */}
      <div
        className="relative overflow-hidden rounded-full"
        style={{
          height: 3,
          marginLeft: node.depth * 20 + 8,
          marginRight: 8,
          marginTop: 1,
          marginBottom: 1,
          background: "var(--devtools-bg-muted)",
          opacity: 0.85,
        }}
      >
        <div
          className="absolute inset-y-0 rounded-full"
          style={{
            left: `${barLeft}%`,
            width: `${barWidth}%`,
            background: accent,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Semantic kind label helpers (design pattern: per-row kind chip).
// Values come from the backend's canonical primitive taxonomy.
// ---------------------------------------------------------------------------

type SemanticKind =
  | "flow"
  | "session"
  | "step"
  | "agent"
  | "generate"
  | "resolve"
  | "tool"
  | "retrieval"
  | "score"
  | "handoff"
  | "swarm"
  | "pipeline"
  | "consensus"
  | "trace"
  | "memory"
  | "thread"
  | "embed"
  | "security"
  | "other";

export function semanticKindFor(node: SpanNode): SemanticKind {
  switch (node.primitive) {
    case "composition.pipeline":
    case "pipeline":
      return "pipeline";
    case "composition.parallel":
    case "parallel":
      return "flow";
    case "composition.consensus":
    case "consensus":
      return "consensus";
    case "composition.swarm":
    case "swarm":
      return "swarm";
    case "flow.run":
    case "flow":
    case "eval.run":
      return "flow";
    case "flow.step":
      return "step";
    case "agent.run":
    case "agent":
      return "agent";
    case "generation.call":
    case "generation.stream":
    case "generation":
      return "generate";
    case "tool.call":
    case "tool.approval":
    case "tool":
      return "tool";
    case "retrieval.query":
    case "retrieval.pipeline":
    case "retrieval":
    case "retrieval.stage":
    case "retrieval.step":
      return "retrieval";
    case "scoring.judge":
    case "judge":
      return "score";
    case "handoff.prepare":
    case "handoff":
    case "delegate.invoke":
    case "delegate":
      return "handoff";
    case "memory.read":
    case "memory.write":
    case "memory":
    case "blackboard":
      return "memory";
    case "thread.operation":
    case "thread":
      return "thread";
    case "embedding.call":
    case "embed":
      return "embed";
    case "security.warning":
    case "security":
      return "security";
    case "prompt.resolve":
      return "resolve";
    case "citation.check":
      return "score";
    case "trace":
    case "run":
      return "trace";
  }
  // Prefix fallback so any primitive not enumerated above (e.g. a new
  // `retrieval.pipeline`, or operation reports) maps to its family instead of
  // falling through to the generic "trace" tag.
  const p = node.primitive ?? "";
  if (p.startsWith("retrieval.") || p.startsWith("knowledge."))
    return "retrieval";
  if (p.startsWith("embedding.")) return "embed";
  if (p.startsWith("memory.") || p.startsWith("blackboard")) return "memory";
  if (p.startsWith("thread.")) return "thread";
  if (p.startsWith("generation.")) return "generate";
  if (p.startsWith("tool.")) return "tool";
  if (p.startsWith("agent.")) return "agent";
  if (p.startsWith("handoff.") || p.startsWith("delegate.")) return "handoff";
  if (p.startsWith("security.")) return "security";
  if (p.startsWith("scoring.") || p.startsWith("eval.")) return "score";
  if (p.startsWith("composition.") || p.startsWith("flow")) return "flow";
  if (
    /^(routing|cache|compaction|constraint|guardrail|corpus|indexing|ingest|plan|fallback)\./.test(
      p,
    )
  )
    return "other";

  if (node.kind === "flow") return "flow";
  if (node.kind === "session") return "session";
  if (node.kind === "step") return "step";
  if (node.kind === "handoff") return "handoff";
  // Only genuine run/trace roots (handled by the explicit `trace`/`run` cases
  // above) should read as "trace"; anything else unknown is "other".
  return p === "run" || p === "trace" ? "trace" : "other";
}

function kindHexColor(k: SemanticKind): string {
  switch (k) {
    case "flow":
      return "var(--devtools-crux)";
    case "agent":
    case "swarm":
    case "consensus":
      return "var(--devtools-iris)";
    case "generate":
    case "pipeline":
      return "var(--devtools-warn)";
    case "tool":
      return "var(--devtools-fg-muted)";
    case "retrieval":
      return "var(--devtools-ok)";
    case "score":
    case "memory":
    case "thread":
      return "var(--devtools-iris)";
    case "embed":
    case "security":
      return "var(--devtools-danger)";
    case "handoff":
      return "var(--devtools-fg-faint)";
    case "session":
    case "step":
    case "resolve":
    case "trace":
      return "var(--devtools-fg-muted)";
    case "other":
      return "var(--devtools-fg-muted)";
  }
}

// ---------------------------------------------------------------------------
// Waterfall bar color helpers
// ---------------------------------------------------------------------------

function kindBarColor(kind: SpanNode["kind"]): string {
  switch (kind) {
    case "session":
      return "bg-(--devtools-fg-faint)";
    case "flow":
      return "bg-(--devtools-iris)";
    case "step":
      return "bg-(--devtools-iris)";
    case "trace":
      return "bg-(--devtools-crux)";
    case "handoff":
      return "bg-(--devtools-warn)";
    case "composition":
      return "bg-fuchsia-500";
  }
}

// ---------------------------------------------------------------------------
// WaterfallRow
// ---------------------------------------------------------------------------

interface WaterfallRowProps {
  node: SpanNode;
  isSelected: boolean;
  isCollapsed: boolean;
  /** This span's turn explanation carries a warning signal — render a badge. */
  warning?: boolean;
  onSelect: (id: string) => void;
  /** Chevron toggle — opens or closes the node. */
  onToggle: (id: string) => void;
  /** Row click — opens (never closes) the node. */
  onExpand: (id: string) => void;
  timelineStart: number;
  timelineEnd: number;
}

function WaterfallRow({
  node,
  isSelected,
  isCollapsed,
  warning,
  onSelect,
  onToggle,
  onExpand,
  timelineStart,
  timelineEnd,
}: WaterfallRowProps) {
  const hasChildren = node.children.length > 0;
  const timeRange = timelineEnd - timelineStart;
  const isError = node.status === "error";
  const isRunning = node.status === "running";

  // Calculate bar position/width as percentage
  const barLeft =
    timeRange > 0 ? ((node.startedAt - timelineStart) / timeRange) * 100 : 0;
  const barWidth =
    timeRange > 0 && node.durationMs != null
      ? Math.max((node.durationMs / timeRange) * 100, 0.5)
      : isRunning
        ? Math.max(100 - barLeft, 0.5)
        : 0.5; // minimal sliver for zero-duration

  // Show the duration inside the bar only when it is wide enough to read it
  // (design: duration label appears on bars roomy enough to hold it).
  const showDur = node.durationMs != null && barWidth > 6;

  return (
    <button
      type="button"
      data-span-id={node.id}
      className={`
        flex items-center w-full text-left text-[11px] h-7 group cursor-pointer border-b border-(--devtools-border)
        ${isSelected ? "bg-(--devtools-bg-muted)" : "hover:bg-(--devtools-bg-muted)/50"}
      `}
      onClick={() => {
        onSelect(node.id);
        if (hasChildren) onExpand(node.id);
      }}
    >
      {/* Left side: label area (fixed width) */}
      <div
        className="flex items-center shrink-0"
        style={{ width: TIMELINE_LABEL_W, paddingLeft: node.depth * 14 }}
      >
        {/* Chevron — toggles open/closed; stops propagation so the row's
            open-only click handler doesn't immediately re-open it. */}
        <span
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={(e) => {
            if (!hasChildren) return;
            e.stopPropagation();
            onToggle(node.id);
          }}
        >
          {hasChildren ? (
            isCollapsed ? (
              <ChevronRight size={12} className="text-(--devtools-fg-faint)" />
            ) : (
              <ChevronDown size={12} className="text-(--devtools-fg-faint)" />
            )
          ) : null}
        </span>

        {/* Status dot */}
        <span className="mx-1 flex items-center">
          <StatusDot status={node.status} />
        </span>

        {/* Kind chip */}
        <span
          className="mr-2 shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.06em]"
          style={{
            color: kindHexColor(semanticKindFor(node)),
            boxShadow: `inset 0 0 0 1px ${kindHexColor(semanticKindFor(node))}`,
          }}
        >
          {semanticKindFor(node)}
        </span>

        {/* Label */}
        <span className="text-(--devtools-fg) truncate min-w-0 flex-1 text-[10px]">
          {node.label}
        </span>

        {(node.redactionLocal ||
          (isCollapsed && node.redactionDescendant)) && (
          <span className="ml-1 flex shrink-0 items-center">
            <RedactionDot
              descendant={!node.redactionLocal && node.redactionDescendant}
            />
          </span>
        )}

        {/* Turn explanation warning — selecting the span opens Explain */}
        {warning && (
          <span
            className="ml-1 shrink-0 text-[10px]"
            style={{ color: "var(--devtools-warn)" }}
            title="Turn explanation has a warning signal — open Explain"
          >
            ✦
          </span>
        )}
      </div>

      {/* Right side: time axis — bar positioned on the shared run timeline.
          No horizontal padding so bars line up exactly with the ruler ticks. */}
      <div
        className="relative h-full min-w-0 flex-1"
        style={{ borderLeft: "1px solid var(--devtools-border)" }}
      >
        <div
          title={`${formatDuration(node.durationMs)}`}
          className={`
            absolute flex items-center overflow-hidden rounded-sm
            ${isError ? "bg-(--devtools-danger)" : kindBarColor(node.kind)}
            ${isRunning && !isError ? "animate-pulse" : ""}
            ${isSelected ? "ring-[1.5px] ring-(--devtools-crux)" : ""}
          `}
          style={{
            top: "50%",
            transform: "translateY(-50%)",
            height: 14,
            left: `${barLeft}%`,
            width: `max(${barWidth}%, 3px)`,
            maxWidth: "100%",
            opacity: isSelected ? 0.95 : 0.78,
          }}
        >
          {showDur && (
            <span className="px-1 text-[8.5px] font-semibold tabular-nums whitespace-nowrap text-(--devtools-bg)">
              {formatDuration(node.durationMs)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// SpanTree
// ---------------------------------------------------------------------------

export function SpanTree({
  tree,
  selectedId,
  warningSpanIds,
  onSelect,
  layout,
  triage = false,
}: SpanTreeProps) {
  const [searchQuery, setSearchQuery] = useState("");
  // The span tree filter rebuilds a potentially large render. Defer the
  // query value so typing stays responsive on big traces; dim the
  // results while we're still catching up.
  const deferredSearch = useDeferredValue(searchQuery);
  const isFilterPending = searchQuery !== deferredSearch;
  // When `layout` is provided the lens owns Tree↔Timeline and the inline
  // toggle is hidden; otherwise the component manages its own view mode.
  const [internalViewMode, setInternalViewMode] = useState<ViewMode>("tree");
  const viewMode = layout ?? internalViewMode;
  const setViewMode = setInternalViewMode;
  const containerRef = useRef<HTMLDivElement>(null);

  // Failure-first triage: when the run failed, open collapsed to the failure
  // path — every node off the path to a failing span folds away, siblings stay
  // visible as folded rows. Computed over the full set, so deep failures still
  // surface. `triageActive` flips off once the user hits "expand all".
  const failurePath = useMemo(() => nodesOnFailurePath(tree), [tree]);
  const triageOnOpen = triage && failurePath.size > 0;
  const [triageActive, setTriageActive] = useState(triageOnOpen);

  // Default collapsed state: failure path in triage, else expand first 2 levels.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    const all = collectAll(tree);
    const initialCollapsed = new Set<string>();
    if (triageOnOpen) {
      for (const n of all) {
        if (n.children.length > 0 && !failurePath.has(n.id))
          initialCollapsed.add(n.id);
      }
      return initialCollapsed;
    }
    for (const n of all) {
      if (n.depth >= 2 && n.children.length > 0) {
        initialCollapsed.add(n.id);
      }
    }
    return initialCollapsed;
  });

  // "failure path · expand all" — escape triage, expand everything.
  const expandAll = useCallback(() => {
    setTriageActive(false);
    setCollapsed(new Set());
  }, []);

  // Minimap viewport tracking — top-of-viewport ratio + visible fraction.
  const [scroll, setScroll] = useState({ ratio: 0, viewport: 1 });
  const onContainerScroll = useCallback((e: ReactUIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const scrollable = el.scrollHeight - el.clientHeight;
    setScroll({
      ratio: scrollable > 0 ? el.scrollTop / scrollable : 0,
      viewport: el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1,
    });
  }, []);
  const jumpTo = useCallback((fraction: number) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTop = fraction * (el.scrollHeight - el.clientHeight);
  }, []);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Row click opens (and selects) but never closes — collapsing is reserved
  // for the chevron toggle. Expanding an already-open row is a no-op.
  const expandRow = useCallback((id: string) => {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // Collapse redundant FLOW > STEP wrappers before any other processing
  const cleanedTree = useMemo(() => collapseRedundantSteps(tree), [tree]);

  // Full-set status sequence drives the minimap (orientation over the whole
  // tree, never just the rendered rows).
  const fullStatuses = useMemo(() => flatStatuses(cleanedTree), [cleanedTree]);
  const showMinimap = !searchQuery && fullStatuses.length > MINIMAP_THRESHOLD;

  // Deep-link / cross-lens selection: when a span is selected (e.g. the URL
  // carries `spanId`), expand its ancestors so the row is actually visible —
  // the default view only opens the first two levels.
  useEffect(() => {
    if (!selectedId) return;
    const path = pathToNode(cleanedTree, selectedId);
    if (!path) return;
    const ancestors = path.slice(0, -1); // everything above the node itself
    setCollapsed((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedId, cleanedTree]);

  // Apply search filter — reads the deferred value so the input itself
  // never blocks on a heavy tree filter pass.
  const filteredTree = useMemo(() => {
    if (!deferredSearch.trim()) return cleanedTree;
    return filterTree(cleanedTree, deferredSearch.trim());
  }, [cleanedTree, deferredSearch]);

  // Flatten visible nodes
  const visibleNodes = useMemo(() => {
    if (!filteredTree) return [];
    return flattenVisible(filteredTree, collapsed);
  }, [filteredTree, collapsed]);

  // Compute timeline range from all visible nodes
  const { timelineStart, timelineEnd } = useMemo(() => {
    if (visibleNodes.length === 0) return { timelineStart: 0, timelineEnd: 1 };
    let min = Infinity;
    let max = -Infinity;
    for (const n of visibleNodes) {
      if (n.startedAt < min) min = n.startedAt;
      const end = n.startedAt + (n.durationMs ?? 0);
      if (end > max) max = end;
    }
    if (min === max) max = min + 1; // prevent zero range
    return { timelineStart: min, timelineEnd: max };
  }, [visibleNodes]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const idx = visibleNodes.findIndex((n) => n.id === selectedId);
      if (idx === -1) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          if (idx < visibleNodes.length - 1) onSelect(visibleNodes[idx + 1].id);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          if (idx > 0) onSelect(visibleNodes[idx - 1].id);
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const node = visibleNodes[idx];
          if (node.children.length > 0 && collapsed.has(node.id)) {
            toggleCollapse(node.id);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const node = visibleNodes[idx];
          if (node.children.length > 0 && !collapsed.has(node.id)) {
            toggleCollapse(node.id);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedId, visibleNodes, collapsed, onSelect, toggleCollapse]);

  // Scroll the selected row into view when the selection changes (deep-linked
  // `spanId`, or selection synced from another lens). Runs after `visibleNodes`
  // so it fires once the ancestor-expand effect above has revealed the row.
  useEffect(() => {
    if (!selectedId) return;
    // Quoted attribute-value selector — escape only `"`/`\` (NOT CSS.escape,
    // which would mangle the `:` in ids like `span:span_…` and never match).
    const safe = selectedId.replace(/["\\]/g, "\\$&");
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-span-id="${safe}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedId, visibleNodes]);

  // Seed the minimap viewport marker from the current container metrics
  // whenever the row set changes (mount, expand/collapse) — otherwise the
  // marker reads full-height until the first scroll event.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !showMinimap) return;
    const scrollable = el.scrollHeight - el.clientHeight;
    setScroll({
      ratio: scrollable > 0 ? el.scrollTop / scrollable : 0,
      viewport: el.scrollHeight > 0 ? el.clientHeight / el.scrollHeight : 1,
    });
  }, [showMinimap, visibleNodes]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-(--devtools-bg)">
      {/* Header controls */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-(--devtools-border) shrink-0">
        <div className="flex items-center flex-1 gap-1.5 bg-(--devtools-bg-muted) rounded px-2 py-1">
          <Search size={12} className="text-(--devtools-fg-faint) shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter spans..."
            className="bg-transparent text-[11px] text-(--devtools-fg) placeholder:text-(--devtools-fg-faint) outline-none w-full"
          />
        </div>

        {/* Total run duration — anchors the time axis (Timeline only). */}
        {viewMode === "timeline" && visibleNodes.length > 0 && (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-(--devtools-fg-faint)">
            {formatDuration(timelineEnd - timelineStart)}
          </span>
        )}

        {/* Tree / Timeline toggle — only when uncontrolled (no lens-driven layout) */}
        {layout == null && (
          <div className="flex items-center bg-(--devtools-bg-muted) rounded p-0.5 shrink-0">
            <button
              type="button"
              title="Tree view"
              className={`flex items-center justify-center w-6 h-5 rounded cursor-pointer ${
                viewMode === "tree"
                  ? "bg-(--devtools-border-strong) text-(--devtools-fg)"
                  : "text-(--devtools-fg-faint) hover:text-(--devtools-fg-muted)"
              }`}
              onClick={() => setViewMode("tree")}
            >
              <List size={12} />
            </button>
            <button
              type="button"
              title="Timeline view"
              className={`flex items-center justify-center w-6 h-5 rounded cursor-pointer ${
                viewMode === "timeline"
                  ? "bg-(--devtools-border-strong) text-(--devtools-fg)"
                  : "text-(--devtools-fg-faint) hover:text-(--devtools-fg-muted)"
              }`}
              onClick={() => setViewMode("timeline")}
            >
              <BarChart3 size={12} />
            </button>
          </div>
        )}
      </div>

      {/* Triage banner — legible + reversible. The run opened folded to the
          failure path; "expand all" escapes it. */}
      {triageActive && (
        <div
          className="flex shrink-0 items-center gap-2 px-2.5 py-1.5"
          style={{
            background: "var(--devtools-danger-soft)",
            borderBottom: "1px solid var(--devtools-border)",
          }}
        >
          <AlertTriangle size={12} className="shrink-0 text-(--devtools-danger)" />
          <span className="text-[11.5px] font-medium text-(--devtools-fg)">
            failure path · {failurePath.size} of {fullStatuses.length} spans
          </span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={expandAll}
            className="cursor-pointer font-mono text-[10.5px] text-(--devtools-crux) hover:underline"
          >
            expand all
          </button>
        </div>
      )}

      {/* Time-axis ruler (Timeline only) — ticks align with the bars below
          because both hang off the same TIMELINE_LABEL_W label column. */}
      {viewMode === "timeline" &&
        filteredTree != null &&
        visibleNodes.length > 0 && (
          <div
            className="grid shrink-0 border-b border-(--devtools-border)"
            style={{ gridTemplateColumns: `${TIMELINE_LABEL_W}px 1fr` }}
          >
            <div className="px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.06em] text-(--devtools-fg-faint)">
              span
            </div>
            <div
              className="relative h-6"
              style={{ borderLeft: "1px solid var(--devtools-border)" }}
            >
              {[0, 0.25, 0.5, 0.75].map((frac) => (
                <div
                  key={frac}
                  className="absolute inset-y-0 flex items-center pl-1 font-mono text-[9px] text-(--devtools-fg-faint)"
                  style={{
                    left: `${frac * 100}%`,
                    borderLeft:
                      frac > 0 ? "1px solid var(--devtools-border)" : "none",
                  }}
                >
                  {formatDuration(frac * (timelineEnd - timelineStart))}
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Content + status minimap (design `dx-workbench` triage state). The
          minimap is a layout-inert sibling, not inside the scroll. */}
      <div className="flex min-h-0 flex-1">
        {/* Content — dimmed while the deferred filter is still catching up
          with the typed query (typical on very deep traces). */}
        <div
          ref={containerRef}
          onScroll={showMinimap ? onContainerScroll : undefined}
          className="flex-1 min-h-0 overflow-y-auto transition-opacity"
          style={{ opacity: isFilterPending ? 0.6 : 1 }}
        >
          {filteredTree == null ? (
            <div className="flex items-center justify-center h-full text-(--devtools-fg-faint) text-[11px]">
              No spans match filter
            </div>
          ) : viewMode === "tree" ? (
            visibleNodes.map((node) => (
              <RowErrorBoundary key={node.id} rowKey={node.id}>
                <SpanRow
                  node={node}
                  isSelected={node.id === selectedId}
                  isCollapsed={collapsed.has(node.id)}
                  warning={warningSpanIds?.has(node.id) ?? false}
                  onSelect={onSelect}
                  onToggle={toggleCollapse}
                  onExpand={expandRow}
                  timelineStart={timelineStart}
                  timelineEnd={timelineEnd}
                />
              </RowErrorBoundary>
            ))
          ) : (
            visibleNodes.map((node) => (
              <RowErrorBoundary key={node.id} rowKey={node.id}>
                <WaterfallRow
                  node={node}
                  isSelected={node.id === selectedId}
                  isCollapsed={collapsed.has(node.id)}
                  warning={warningSpanIds?.has(node.id) ?? false}
                  onSelect={onSelect}
                  onToggle={toggleCollapse}
                  onExpand={expandRow}
                  timelineStart={timelineStart}
                  timelineEnd={timelineEnd}
                />
              </RowErrorBoundary>
            ))
          )}
        </div>
        {showMinimap && filteredTree != null && (
          <div
            className="flex shrink-0 py-1.5 pl-1 pr-1.5"
            style={{ borderLeft: "1px solid var(--devtools-border)" }}
          >
            <TriageMinimap
              statuses={fullStatuses}
              scrollRatio={scroll.ratio}
              viewportRatio={scroll.viewport}
              onJump={jumpTo}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface SpanTreeProps {
  tree: SpanNode;
  selectedId: string | null;
  /** Span ids whose turn explanation carries a warning signal — render badges. */
  warningSpanIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  /** Controlled view layout. When set, the lens owns Tree↔Timeline and the
   *  inline toggle is hidden. Omit for the standalone, self-toggling tree. */
  layout?: ViewMode;
  /** Failure-first triage: when the run failed, the tree opens collapsed to
   *  the failure path (siblings folded) until "expand all" escapes it. */
  triage?: boolean;
}
