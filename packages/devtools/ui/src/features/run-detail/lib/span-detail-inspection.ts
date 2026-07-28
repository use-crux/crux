import type { ChipTone } from "@/devtools/shell/primitives";
import type {
  DroppedContext,
  ExcludedContext,
  InspectPart,
  ObservabilityRunDetailDetail,
  ObservabilityRunDetailNode,
  ObservabilitySpanEventSummary,
  Trace,
} from "@/types";

// Center pane = content only. Evidence (metadata, attributes, relations,
// diagnostics) live in the Inspector; structure (graph) is a lens — neither is
// a center tab.
export type InspectTabId =
  | "insight"
  | "output"
  | "context"
  | "tool"
  | "memory"
  | "handoff"
  | "tools"
  | "retrieval"
  | "scores"
  | "citations"
  | "children"
  | "eval"
  | "report"
  | "composition"
  | "agent";

export const TAB_LABEL: Record<InspectTabId, string> = {
  insight: "Insight",
  output: "Output",
  context: "Context",
  tool: "Tool",
  memory: "Memory",
  handoff: "Handoff",
  tools: "Tools",
  retrieval: "Retrieval",
  scores: "Scores",
  citations: "Citations",
  children: "Children",
  eval: "Verdict",
  report: "Report",
  composition: "Composition",
  agent: "Loop",
};

export type PrimitiveKind =
  | "run"
  | "generation"
  | "agent"
  | "tool"
  | "memory-capture"
  | "memory"
  | "handoff"
  | "retrieval"
  | "eval"
  | "operation"
  | "composition"
  | "suspension"
  | "group"
  | "other";

export function classifyPrimitive(
  primitive: string | undefined,
): PrimitiveKind {
  if (!primitive) return "other";
  if (primitive === "run") return "run";
  if (primitive === "flow.suspension") return "suspension";
  if (primitive.startsWith("generation.")) return "generation";
  if (primitive.startsWith("media.")) return "operation";
  if (primitive.startsWith("agent.")) return "agent";
  if (primitive.startsWith("tool.")) return "tool";
  if (primitive === "memory.capture") return "memory-capture";
  if (primitive.startsWith("memory.")) return "memory";
  if (primitive.startsWith("handoff.") || primitive.startsWith("delegate."))
    return "handoff";
  if (primitive.startsWith("retrieval.") || primitive.startsWith("embedding."))
    return "retrieval";
  if (primitive.startsWith("eval.") || primitive.startsWith("scoring."))
    return "eval";
  if (
    primitive.startsWith("constraint.") ||
    primitive.startsWith("guardrail.") ||
    primitive.startsWith("routing.") ||
    primitive.startsWith("fallback.") ||
    primitive.startsWith("cache.") ||
    primitive.startsWith("compaction.") ||
    primitive.startsWith("security.") ||
    primitive.startsWith("corpus.") ||
    primitive.startsWith("indexing.") ||
    primitive.startsWith("ingest.") ||
    primitive.startsWith("plan.")
  )
    return "operation";
  if (primitive.startsWith("composition.")) return "composition";
  if (primitive.startsWith("flow")) return "group";
  return "other";
}

export function tabsForKind(kind: PrimitiveKind): readonly InspectTabId[] {
  switch (kind) {
    case "generation":
      // Spec §4: generation = Output · Context only (Output is the default
      // landing). Generated tool calls + reasoning + grounding fold into
      // Output; scores/relations/metadata → Inspector.
      return ["output", "context"];
    case "agent":
      // Spec §4: agent.run = instructions + tools-available + react loop (+ the
      // agent's final Output).
      return ["agent", "output"];
    case "run":
      return ["output", "context", "tools", "retrieval", "scores", "citations"];
    case "tool":
      return ["tool"];
    case "memory-capture":
    case "memory":
      return ["memory"];
    case "handoff":
      return ["handoff"];
    case "retrieval":
      return ["retrieval"];
    case "eval":
      return ["eval", "output"];
    case "operation":
      return ["report", "output"];
    case "composition":
      return ["composition", "children"];
    case "suspension":
      return ["output"];
    case "group":
      // Structure (children/steps) is the content; the Graph lens and the
      // tree own the visual hierarchy.
      return ["children"];
    default:
      return ["output"];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

// Coarse kind → family accent. This is the fallback for the lumped
// `PrimitiveKind` buckets; prefer `primitiveAccentVar(node.primitive)` from
// `./families` wherever the full primitive is available (it can distinguish the
// Safety / Routing / State members that `classifyPrimitive` collapses into
// `operation`). Tones follow the design families: State=plum, Evaluation=gold,
// Orchestration=crux, Transition=faint.
export const KIND_ACCENT: Record<PrimitiveKind, string> = {
  run: "var(--devtools-crux)",
  generation: "var(--devtools-warn)",
  agent: "var(--devtools-iris)",
  tool: "var(--devtools-fg-muted)",
  "memory-capture": "var(--devtools-plum)",
  memory: "var(--devtools-plum)",
  handoff: "var(--devtools-fg-faint)",
  retrieval: "var(--devtools-ok)",
  eval: "var(--devtools-gold)",
  operation: "var(--devtools-plum)",
  composition: "var(--devtools-crux)",
  suspension: "var(--devtools-crux)",
  group: "var(--devtools-crux)",
  other: "var(--devtools-fg-muted)",
};

export const COMPOSITION_PALETTE = [
  "var(--devtools-crux)",
  "var(--devtools-ok)",
  "var(--devtools-iris)",
  "var(--devtools-warn)",
  "oklch(70% 0.13 220)",
  "oklch(70% 0.13 160)",
  "oklch(70% 0.13 320)",
  "oklch(70% 0.13 60)",
];

export function statusTone(status: string | undefined): ChipTone {
  switch (status) {
    case "ok":
    case "success":
    case "passed":
      return "ok";
    case "running":
      return "crux";
    case "error":
    case "fail":
    case "failed":
      return "danger";
    case "blocked":
      // Guardrails / constraints / safety blocks — new first-class status
      // from the backend. Render distinctly from 'error'.
      return "danger";
    case "suspended":
      // First-class suspension state (e.g. flow.suspension waiting for human
      // approval). Per the design status vocab it shares running's teal tone —
      // the label + icon disambiguate (matches StatusPill in atoms.tsx).
      return "crux";
    case "cancelled":
      return "muted";
    case "warn":
    case "warning":
    case "incomplete":
    case "stale":
      return "warn";
    default:
      return "muted";
  }
}

export function statusLabel(status: string | undefined): string {
  if (!status) return "unknown";
  if (status === "success") return "ok";
  return status;
}

// ─── Inspection-section helpers ─────────────────────────────────────
//
// The new backend ships a curated `inspection` field on each presentation
// node with the per-tab groupings the UI used to derive itself:
//
//   inspection: {
//     tools?: InspectionItem[]
//     retrieval?: InspectionItem[]
//     memory?: InspectionItem[]
//     context?: InspectionItem[]
//     safety?: InspectionItem[]
//     scores?: InspectionItem[]
//     citations?: InspectionItem[]
//     events?: InspectionItem[]
//     diagnostics?: InspectionItem[]
//     metrics?: InspectionItem[]
//     messages?: InspectionItem[]
//     output?: InspectionItem[]
//     errors?: InspectionItem[]
//     raw?: InspectionItem[]
//     relations?: InspectionItem[]
//   }
//
// Each item is `{ type: 'span' | 'artifact' | 'event', id, label, kind,
// role?, sourceSpanId, data: <the underlying record> }`. We prefe
// inspection sections over walking artifacts/details when they're
// present so the UI just renders what the backend decided is relevant.
//

export interface InspectionItem {
  type?: "span" | "artifact" | "event" | string;
  id: string;
  label?: string;
  kind?: string;
  role?: string;
  sourceSpanId?: string;
  data?: unknown;
}

export interface NodeInspection {
  tools?: InspectionItem[];
  retrieval?: InspectionItem[];
  memory?: InspectionItem[];
  context?: InspectionItem[];
  safety?: InspectionItem[];
  scores?: InspectionItem[];
  citations?: InspectionItem[];
  events?: InspectionItem[];
  diagnostics?: InspectionItem[];
  metrics?: InspectionItem[];
  messages?: InspectionItem[];
  input?: InspectionItem[];
  output?: InspectionItem[];
  errors?: InspectionItem[];
  raw?: InspectionItem[];
  relations?: InspectionItem[];
}

export function inspectionOf(
  node: ObservabilityRunDetailNode | undefined,
): NodeInspection | undefined {
  if (!node) return undefined;
  return (node as ObservabilityRunDetailNode & { inspection?: NodeInspection })
    .inspection;
}

export interface ResolvedSpanErrorEvidence {
  label: string;
  kind?: string;
  preview: string;
  data?: unknown;
}

export interface ResolvedSpanError {
  summary: string;
  name?: string;
  category?: string;
  code?: string;
  phase?: string;
  retryable?: boolean;
  stack?: string;
  raw?: unknown;
  evidence: readonly ResolvedSpanErrorEvidence[];
}

export function resolveSpanError(
  node: ObservabilityRunDetailNode | undefined,
): ResolvedSpanError | null {
  if (!node) return null;

  const evidence: ResolvedSpanErrorEvidence[] = [];
  let resolved = errorFromUnknown(
    (node as ObservabilityRunDetailNode & { error?: unknown }).error,
  );
  let stackFallback: string | undefined;
  let rawFallback: unknown;

  for (const item of inspectionOf(node)?.errors ?? []) {
    const itemError = errorFromUnknown(item.data);
    if (!resolved && item.type === "span.error") {
      resolved = itemError;
    }
    const itemStack = stackFromUnknown(item.data);
    if (!stackFallback && itemStack) stackFallback = itemStack;
    if (
      rawFallback === undefined &&
      (item.kind === "error.raw" || item.label === "error.raw")
    ) {
      rawFallback = item.data;
    }
    if (item.type !== "span.error") {
      const preview = errorEvidencePreview(item.data);
      if (preview) {
        evidence.push({
          label: item.label ?? item.kind ?? item.type ?? item.id,
          kind: item.kind,
          preview,
          data: item.data,
        });
      }
    }
  }

  const stackArtifact = findArtifact(node, "error.stack");
  if (stackArtifact?.preview !== undefined) {
    const stack = stackFromUnknown(stackArtifact.preview);
    if (!stackFallback && stack) stackFallback = stack;
    const preview = errorEvidencePreview(stackArtifact.preview);
    if (preview) {
      evidence.push({
        label: "error.stack",
        kind: "error.stack",
        preview,
        data: stackArtifact.preview,
      });
    }
  }

  const rawArtifact = findArtifact(node, "error.raw");
  if (rawArtifact?.preview !== undefined) {
    rawFallback ??= rawArtifact.preview;
    resolved ??= errorFromUnknown(rawArtifact.preview);
    const preview = errorEvidencePreview(rawArtifact.preview);
    if (preview) {
      evidence.push({
        label: "error.raw",
        kind: "error.raw",
        preview,
        data: rawArtifact.preview,
      });
    }
  }

  if (!resolved && stackArtifact?.preview !== undefined) {
    resolved = errorFromUnknown(stackArtifact.preview);
  }
  if (!resolved) return null;

  return {
    ...resolved,
    stack: resolved.stack ?? stackFallback,
    raw: resolved.raw ?? rawFallback,
    evidence,
  };
}

function errorFromUnknown(
  value: unknown,
): Omit<ResolvedSpanError, "evidence"> | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const summary = value.trim();
    return summary ? { summary } : null;
  }

  const record = asRecord(value);
  if (!record) return null;
  const summaryRecord = asRecord(record.summary);
  const source = summaryRecord ?? record;
  const summary =
    textField(source, "message") ??
    textField(source, "summary") ??
    textField(record, "message") ??
    textField(source, "error") ??
    textField(source, "name") ??
    oneLine(value);
  if (!summary) return null;

  return {
    summary,
    name:
      textField(source, "name") ??
      textField(record, "name") ??
      textField(source, "type") ??
      textField(record, "thrown"),
    category: textField(source, "category") ?? textField(record, "category"),
    code:
      textField(source, "code") ??
      textField(source, "statusCode") ??
      textField(record, "code") ??
      textField(record, "statusCode"),
    phase: textField(source, "phase") ?? textField(record, "phase"),
    retryable: boolField(source, "retryable") ?? boolField(record, "retryable"),
    stack: stackFromUnknown(value),
    raw: record.raw ?? value,
  };
}

function errorEvidencePreview(value: unknown): string | undefined {
  const stack = stackFromUnknown(value);
  if (stack) return stackPreview(stack);
  const resolved = errorFromUnknown(value);
  if (resolved?.summary) return resolved.summary;
  return oneLine(value);
}

function stackFromUnknown(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return textField(record, "stack");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Record<string, unknown>;
}

function textField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function boolField(
  record: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function stackPreview(stack: string): string {
  return stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" | ");
}

function oneLine(value: unknown): string | undefined {
  try {
    return JSON.stringify(value).replace(/\s+/g, " ");
  } catch {
    return String(value);
  }
}

export interface NodeSource {
  placementReason?: string;
  ownerSpanId?: string;
  canonicalParentSpanId?: string;
}

export function sourceOf(
  node: ObservabilityRunDetailNode | undefined,
): NodeSource | undefined {
  if (!node) return undefined;
  return (node as ObservabilityRunDetailNode & { source?: NodeSource }).source;
}

export function fmtDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function fmtTokens(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function fmtCost(c: number | undefined): string {
  if (c == null || !Number.isFinite(c)) return "—";
  if (c < 0.0001) return `$${c.toFixed(6)}`;
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(3)}`;
}

export function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function readMetric(
  node: ObservabilityRunDetailNode | undefined,
  key: string,
): number | undefined {
  if (!node) return undefined;
  // 1. NEW: inspection.metrics — curated usage rollup per node
  const insp = inspectionOf(node);
  if (insp?.metrics) {
    for (const item of insp.metrics) {
      const data = item.data;
      if (data && typeof data === "object") {
        const v = (data as Record<string, unknown>)[key];
        if (typeof v === "number") return v;
      }
    }
  }
  const own = (
    node.metricBuckets?.own as Record<string, number | undefined> | undefined
  )?.[key];
  if (typeof own === "number") return own;
  const total = (
    node.metricBuckets?.total as Record<string, number | undefined> | undefined
  )?.[key];
  if (typeof total === "number") return total;
  const flat = (
    node.metrics as Record<string, number | undefined> | null | undefined
  )?.[key];
  if (typeof flat === "number") return flat;
  // Fallback: scrape `usage.observed` events on the node + details — olde
  // runs stored generation usage as event attributes.
  for (const ev of node.events ?? []) {
    if (ev.name === "usage.observed") {
      const v = (ev.attributes as Record<string, unknown> | null | undefined)?.[
        key
      ];
      if (typeof v === "number") return v;
    }
  }
  for (const det of node.details ?? []) {
    for (const ev of det.events ?? []) {
      if (ev.name === "usage.observed") {
        const v = (
          ev.attributes as Record<string, unknown> | null | undefined
        )?.[key];
        if (typeof v === "number") return v;
      }
    }
  }
  // Fallback: scrape inspection.events for usage.observed
  if (insp?.events) {
    for (const ev of insp.events) {
      if (
        ev.kind === "usage.observed" &&
        ev.data &&
        typeof ev.data === "object"
      ) {
        const v = (ev.data as Record<string, unknown>)[key];
        if (typeof v === "number") return v;
      }
    }
  }
  return undefined;
}

/** Roll up a usage metric across the whole subtree (for run-level KPIs). */
export function readMetricDeep(
  node: ObservabilityRunDetailNode | undefined,
  key: string,
): number | undefined {
  if (!node) return undefined;
  let sum = 0;
  let found = false;
  function walk(n: ObservabilityRunDetailNode) {
    const v = readMetric(n, key);
    if (typeof v === "number") {
      sum += v;
      found = true;
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(node);
  return found ? sum : undefined;
}

/** Compute throughput (output tokens per second) from selfMs. */
export function tokensPerSecond(
  node: ObservabilityRunDetailNode | undefined,
): number | undefined {
  if (!node) return undefined;
  const out = readMetric(node, "outputTokens");
  const ms = node.timing?.selfMs ?? node.timing?.durationMs;
  if (out == null || !ms || ms <= 0) return undefined;
  return out / (ms / 1000);
}

export function finishReasonsFor(
  node: ObservabilityRunDetailNode | undefined,
): readonly string[] {
  if (!node) return [];
  const out = new Set<string>();
  for (const ev of node.events ?? []) {
    if (ev.name === "generation.step") {
      const r = (ev.attributes as { finishReason?: unknown } | null | undefined)
        ?.finishReason;
      if (typeof r === "string") out.add(r);
    }
  }
  return Array.from(out);
}

export interface ModelUse {
  provider?: string;
  model?: string;
  responseId?: string;
  owner: ObservabilityRunDetailNode;
}

/**
 * Trace back which model(s) backed a generation. The new Go backend
 * doesn't populate `node.model` / `node.provider` — the actual routed
 * model lives on the output artifact's `meta.actualModelId`, and the
 * provider is recorded as a span attribute. A parent (run / agent /
 * stream) span aggregates across its descendant `generation.call` spans.
 */
export function resolveModels(
  node: ObservabilityRunDetailNode | undefined,
): readonly ModelUse[] {
  if (!node) return [];
  const out: ModelUse[] = [];
  function readMeta(n: ObservabilityRunDetailNode): {
    model?: string;
    responseId?: string;
  } {
    for (const art of n.artifacts ?? []) {
      if (
        art.kind === "output" &&
        art.preview &&
        typeof art.preview === "object"
      ) {
        const meta = (
          art.preview as {
            meta?: {
              actualModelId?: unknown;
              responseId?: unknown;
              modelId?: unknown;
            };
          }
        ).meta;
        if (meta) {
          const m =
            typeof meta.actualModelId === "string"
              ? meta.actualModelId
              : typeof meta.modelId === "string"
                ? meta.modelId
                : undefined;
          const r =
            typeof meta.responseId === "string" ? meta.responseId : undefined;
          if (m || r) return { model: m, responseId: r };
        }
      }
    }
    return {};
  }
  function readProvider(n: ObservabilityRunDetailNode): string | undefined {
    if (n.provider) return n.provider;
    const p = (
      n.attributes as
        | { provider?: unknown; providerId?: unknown }
        | null
        | undefined
    )?.provider;
    if (typeof p === "string") return p;
    const pid = (n.attributes as { providerId?: unknown } | null | undefined)
      ?.providerId;
    return typeof pid === "string" ? pid : undefined;
  }
  function walk(n: ObservabilityRunDetailNode) {
    if (n.primitive.startsWith("generation.")) {
      const directModel = n.model || undefined;
      const meta = readMeta(n);
      const provider = readProvider(n);
      const model = directModel ?? meta.model;
      if (provider || model || meta.responseId) {
        out.push({ provider, model, responseId: meta.responseId, owner: n });
      }
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(node);
  return out;
}

/** Tools offered to the model in a node's request. For generations the toolset
 *  lives on the **nearest agent ancestor** (`attributes.toolNames`), not the
 *  generation span; `used` = which of them were actually called under it. */
export function providedToolsForNode(
  root: ObservabilityRunDetailNode,
  nodeId: string,
): { name: string; used: boolean }[] {
  const path: ObservabilityRunDetailNode[] = [];
  const dfs = (
    n: ObservabilityRunDetailNode,
    trail: ObservabilityRunDetailNode[],
  ): boolean => {
    const next = [...trail, n];
    if (n.id === nodeId) {
      path.push(...next);
      return true;
    }
    for (const c of n.children ?? []) if (dfs(c, next)) return true;
    return false;
  };
  dfs(root, []);
  const owner =
    [...path].reverse().find((n) => n.primitive === "agent.run") ??
    path[path.length - 1] ??
    root;
  const attrs = (owner.attributes ?? {}) as Record<string, unknown>;
  const declared = Array.isArray(attrs.toolNames)
    ? (attrs.toolNames.filter(
        (x): x is string => typeof x === "string",
      ) as string[])
    : [];
  const used = new Set<string>();
  for (const d of gatherDescendants(owner)) {
    if (d.toolName) used.add(d.toolName);
    else if (d.primitive === "tool.call" && d.name) used.add(d.name);
  }
  const all = new Set<string>(declared);
  used.forEach((u) => all.add(u));
  return Array.from(all)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, used: used.has(name) }));
}

/** Pretty-format a model id by stripping common provider prefixes. */
export function shortModelId(model: string | undefined): string | undefined {
  if (!model) return undefined;
  // Strip leading `provider/` segment when present (openrouter style).
  const slash = model.indexOf("/");
  if (slash >= 0 && slash < model.length - 1) return model.slice(slash + 1);
  return model;
}

export function nodeTokens(
  node: ObservabilityRunDetailNode | undefined,
): number | undefined {
  return readMetric(node, "totalTokens") ?? readMetric(node, "outputTokens");
}

export function nodeCost(
  node: ObservabilityRunDetailNode | undefined,
): number | undefined {
  // Canonical `costUsd` now lands in metricBuckets (M1). `cost` is the legacy
  // fallback for historical/sparse runs (see BACKEND-GAPS-FROM-UI #M1).
  return readMetric(node, "costUsd") ?? readMetric(node, "cost");
}

/** Cache-read tokens — canonical `cacheReadTokens` (M2), with the legacy
 *  `cachedInputTokens` spelling as a fallback for historical runs. */
export function nodeCacheTokens(
  node: ObservabilityRunDetailNode | undefined,
): number | undefined {
  return (
    readMetric(node, "cacheReadTokens") ?? readMetric(node, "cachedInputTokens")
  );
}

export function nodeDuration(
  node: ObservabilityRunDetailNode | undefined,
): number | undefined {
  return node?.timing?.durationMs ?? node?.durationMs;
}

export function gatherDescendants(
  node: ObservabilityRunDetailNode,
): readonly ObservabilityRunDetailNode[] {
  const out: ObservabilityRunDetailNode[] = [];
  function walk(n: ObservabilityRunDetailNode) {
    out.push(n);
    for (const detail of n.details ?? []) out.push(detailAsLeafNode(detail, n));
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return out;
}

function detailAsLeafNode(
  detail: ObservabilityRunDetailDetail,
  owner: ObservabilityRunDetailNode,
): ObservabilityRunDetailNode {
  return {
    ...detail,
    virtual: false,
    parentId: owner.id,
    path: [...(owner.path ?? []), detail.id],
    display: {
      kind: detail.kind,
      label: detail.label,
      description: detail.summary,
      icon: detail.role,
    },
    metricBuckets: {
      own: detail.metrics ?? undefined,
      children: undefined,
      details: undefined,
      total: detail.metrics ?? undefined,
    },
    details: [],
    children: [],
  };
}

export function findArtifact(
  node: ObservabilityRunDetailNode | undefined,
  kind: string,
): { preview: unknown; sizeBytes?: number; contentType?: string } | null {
  if (!node) return null;
  for (const art of node.artifacts ?? []) {
    if (art.kind === kind && art.preview !== undefined) {
      return {
        preview: art.preview,
        sizeBytes: art.sizeBytes,
        contentType: art.contentType,
      };
    }
  }
  for (const detail of node.details ?? []) {
    for (const art of detail.artifacts ?? []) {
      if (art.kind === kind && art.preview !== undefined) {
        return {
          preview: art.preview,
          sizeBytes: art.sizeBytes,
          contentType: art.contentType,
        };
      }
    }
  }
  return null;
}

/** Walk node + descendants for the first matching artifact. */
export function findArtifactDeep(
  node: ObservabilityRunDetailNode | undefined,
  kind: string,
): { preview: unknown; sizeBytes?: number; contentType?: string } | null {
  if (!node) return null;
  const direct = findArtifact(node, kind);
  if (direct) return direct;
  for (const child of node.children ?? []) {
    const found = findArtifactDeep(child, kind);
    if (found) return found;
  }
  return null;
}

/** All matching artifacts on node + descendants (own + their details). */
export function findAllArtifacts(
  node: ObservabilityRunDetailNode | undefined,
  kind: string,
): Array<{
  preview: unknown;
  sizeBytes?: number;
  contentType?: string;
  owner: ObservabilityRunDetailNode;
}> {
  const out: Array<{
    preview: unknown;
    sizeBytes?: number;
    contentType?: string;
    owner: ObservabilityRunDetailNode;
  }> = [];
  if (!node) return out;
  function walk(n: ObservabilityRunDetailNode) {
    for (const art of n.artifacts ?? []) {
      if (art.kind === kind && art.preview !== undefined) {
        out.push({
          preview: art.preview,
          sizeBytes: art.sizeBytes,
          contentType: art.contentType,
          owner: n,
        });
      }
    }
    for (const d of n.details ?? []) {
      for (const art of d.artifacts ?? []) {
        if (art.kind === kind && art.preview !== undefined) {
          out.push({
            preview: art.preview,
            sizeBytes: art.sizeBytes,
            contentType: art.contentType,
            owner: n,
          });
        }
      }
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(node);
  return out;
}

/**
 * Gather the context-engineering detail nodes that live under a span.
 * The new backend models contexts as detail records (kind: 'detail') on
 * generation / prompt-resolve spans, with family 'context' or 'prompt'
 * and an attached 'context' artifact whose preview is the resolved text.
 *
 * Returns deduped entries keyed by label so a context that resolves
 * twice during the run shows once.
 */
export interface ResolvedContext {
  label: string;
  source?: string;
  primitive: string;
  family: string;
  priority?: number;
  tokens?: number;
  sizeBytes?: number;
  text?: string;
  body?: unknown;
  hasPredicate: boolean; // checked but no artifact (predicate-only)
  durationMs?: number;
}

export function gatherResolvedContexts(
  node: ObservabilityRunDetailNode | undefined,
): readonly ResolvedContext[] {
  if (!node) return [];
  const byLabel = new Map<string, ResolvedContext>();

  // Prefer the backend-curated inspection.context section — each item
  // wraps the detail node we'd otherwise walk to find ourselves.
  const insp = inspectionOf(node);
  if (insp?.context && insp.context.length > 0) {
    for (const item of insp.context) {
      const data = item.data as Record<string, unknown> | undefined;
      if (!data) continue;
      const family =
        (data.family as string | undefined) ??
        (item.kind?.startsWith("prompt.")
          ? "prompt"
          : item.kind?.startsWith("context.")
            ? "context"
            : "context");
      const label =
        item.label ??
        (
          data.attributes as
            | { contextId?: string; promptId?: string }
            | undefined
        )?.contextId ??
        (data.attributes as { promptId?: string } | undefined)?.promptId ??
        (data.name as string | undefined) ??
        "context";
      const primitive =
        (data.primitive as string | undefined) ??
        item.kind ??
        "context.resolve";
      const attrs = data.attributes as
        | Record<string, unknown>
        | null
        | undefined;
      const priority =
        typeof attrs?.priority === "number"
          ? (attrs.priority as number)
          : undefined;
      const source =
        typeof attrs?.source === "string"
          ? (attrs.source as string)
          : undefined;
      let text: string | undefined;
      let body: unknown;
      let sizeBytes: number | undefined;
      const arts = data.artifacts as
        | Array<{ kind?: string; preview?: unknown; sizeBytes?: number }>
        | undefined;
      for (const art of arts ?? []) {
        if (
          art.kind === "context" ||
          art.kind === "system" ||
          art.kind === "prompt"
        ) {
          if (typeof art.preview === "string") text = art.preview;
          else body = art.preview;
          sizeBytes = art.sizeBytes ?? sizeBytes;
        }
      }
      const existing = byLabel.get(label);
      if (existing) {
        if (!existing.text && text) existing.text = text;
        if (existing.body == null && body != null) existing.body = body;
        if (primitive === "context.predicate") existing.hasPredicate = true;
        continue;
      }
      byLabel.set(label, {
        label,
        source,
        primitive,
        family: family ?? "context",
        priority,
        sizeBytes,
        text,
        body,
        hasPredicate: primitive === "context.predicate",
        durationMs: (data.timing as { durationMs?: number } | undefined)
          ?.durationMs,
      });
    }
    if (byLabel.size > 0) {
      return Array.from(byLabel.values()).sort(
        (a, b) => (b.priority ?? -1) - (a.priority ?? -1),
      );
    }
  }

  function visit(n: ObservabilityRunDetailNode) {
    for (const det of n.details ?? []) {
      const family = (det as { family?: string }).family;
      if (family !== "context" && family !== "prompt") continue;
      const label =
        (det as { label?: string }).label ??
        (
          det.attributes as
            | { contextId?: string; promptId?: string }
            | undefined
        )?.contextId ??
        (det.attributes as { promptId?: string } | undefined)?.promptId ??
        det.name ??
        "context";
      const primitive =
        (det as { primitive?: string }).primitive ?? "context.resolve";
      const attrs = det.attributes as
        | Record<string, unknown>
        | null
        | undefined;
      const priority =
        typeof attrs?.priority === "number"
          ? (attrs.priority as number)
          : undefined;
      const source =
        typeof attrs?.source === "string"
          ? (attrs.source as string)
          : undefined;
      let text: string | undefined;
      let body: unknown;
      let sizeBytes: number | undefined;
      let tokens: number | undefined;
      for (const art of det.artifacts ?? []) {
        if (
          art.kind === "context" ||
          art.kind === "system" ||
          art.kind === "prompt"
        ) {
          if (typeof art.preview === "string") text = art.preview;
          else body = art.preview;
          sizeBytes = art.sizeBytes ?? sizeBytes;
        }
      }
      // Token estimates from attributes / events
      if (typeof attrs?.tokens === "number") tokens = attrs.tokens as number;
      const existing = byLabel.get(label);
      if (existing) {
        // Merge: prefer the variant with text + accumulate predicate flag
        if (!existing.text && text) existing.text = text;
        if (existing.body == null && body != null) existing.body = body;
        if (primitive === "context.predicate") existing.hasPredicate = true;
        continue;
      }
      byLabel.set(label, {
        label,
        source,
        primitive,
        family: family ?? "context",
        priority,
        tokens,
        sizeBytes,
        text,
        body,
        hasPredicate: primitive === "context.predicate",
        durationMs: (det as { timing?: { durationMs?: number } }).timing
          ?.durationMs,
      });
    }
    for (const c of n.children ?? []) visit(c);
  }
  visit(node);
  // Sort by priority desc (higher priority = earlier in prompt)
  return Array.from(byLabel.values()).sort(
    (a, b) => (b.priority ?? -1) - (a.priority ?? -1),
  );
}

/**
 * Find the actual output payload by deep-search.
 * - Prefers the selected node's own output artifact
 * - Falls back to a descendant generation.call / generation.stream
 * - Falls back to trace.result.output / trace.result.text
 * Returns { text, object } unwrapped from the {text, object, meta} envelope
 * when the artifact is wrapped that way.
 */
export interface ResolvedOutput {
  text?: string;
  object?: unknown;
  meta?: {
    usage?: Record<string, number>;
    cost?: number;
    finishReason?: string;
    modelId?: string;
  };
  owner?: ObservabilityRunDetailNode;
}

export type OutputRenderMode = "raw" | "pretty";

export function unwrapOutput(preview: unknown): {
  text?: string;
  object?: unknown;
  meta?: ResolvedOutput["meta"];
} {
  if (preview == null) return {};
  if (typeof preview === "string") return { text: preview };
  if (typeof preview === "object") {
    const obj = preview as Record<string, unknown>;
    const wrapped =
      "text" in obj || "object" in obj || "meta" in obj
        ? {
            text:
              typeof obj.text === "string" ? (obj.text as string) : undefined,
            object: obj.object,
            meta: obj.meta as ResolvedOutput["meta"] | undefined,
          }
        : null;
    if (wrapped) return wrapped;
    return { object: obj };
  }
  return { object: preview };
}

export function resolveOutput(
  node: ObservabilityRunDetailNode | undefined,
  trace: Trace | undefined,
  isRoot: boolean,
): ResolvedOutput {
  if (!node) return {};

  // 1. Prefer the curated inspection.output section if the backend
  //    served one. Each item is `{ data: { text, object, meta } }` already
  //    pointing at the right span via `sourceSpanId`.
  const insp = inspectionOf(node);
  if (insp?.output && insp.output.length > 0) {
    const item = insp.output[0];
    if (item.data != null) {
      const owner = findNode(node, item.sourceSpanId ?? null) ?? node;
      return { ...unwrapOutput(item.data), owner };
    }
  }

  const own = findArtifact(node, "output");
  if (own?.preview != null)
    return { ...unwrapOutput(own.preview), owner: node };

  // Walk descendants. Prefer generation outputs (model text) over outputs
  // from plan/tool/handoff primitives which carry internal payloads. Tie
  // break: take the LAST in walk order so the most-recent step shows.
  let best: { result: ResolvedOutput; rank: number; order: number } | null =
    null;
  let order = 0;
  function rankOf(primitive: string): number {
    if (primitive.startsWith("generation.")) return 3;
    if (primitive.startsWith("agent.")) return 2;
    if (primitive.startsWith("flow") || primitive.startsWith("composition."))
      return 1;
    return 0;
  }
  function consider(owner: ObservabilityRunDetailNode, preview: unknown) {
    const unwrapped = unwrapOutput(preview);
    if (unwrapped.text == null && unwrapped.object == null) return;
    const rank = rankOf(owner.primitive) + (unwrapped.text ? 1 : 0);
    order += 1;
    if (
      !best ||
      rank > best.rank ||
      (rank === best.rank && order > best.order)
    ) {
      best = { result: { ...unwrapped, owner }, rank, order };
    }
  }
  function walk(n: ObservabilityRunDetailNode) {
    for (const art of n.artifacts ?? []) {
      if (art.kind === "output" && art.preview != null)
        consider(n, art.preview);
    }
    for (const d of n.details ?? []) {
      for (const art of d.artifacts ?? []) {
        if (art.kind === "output" && art.preview != null)
          consider(n, art.preview);
      }
    }
    for (const c of n.children ?? []) walk(c);
  }
  walk(node);
  if (best) return (best as { result: ResolvedOutput }).result;

  // Fallback to the operation projection from /api/inspect/runs/{operationId}
  if (isRoot && trace?.result) {
    const r = trace.result as {
      text?: string;
      object?: unknown;
      output?: unknown;
      usage?: unknown;
      cost?: number;
      finishReason?: string;
      modelId?: string;
    };
    if (r.text)
      return {
        text: r.text,
        meta: {
          usage: r.usage as Record<string, number> | undefined,
          cost: r.cost,
          finishReason: r.finishReason,
          modelId: r.modelId,
        },
      };
    if (r.output != null) return { ...unwrapOutput(r.output) };
    if (r.object != null) return { object: r.object };
  }
  return {};
}

/** Extract token chunks still present on legacy/in-memory run detail payloads. */
export function tokenChunks(
  node: ObservabilityRunDetailNode | undefined,
): readonly string[] {
  if (!node) return [];
  const events: TokenChunkEvent[] = [];
  function visit(n: ObservabilityRunDetailNode) {
    events.push(...(n.events ?? []));
    for (const detail of n.details ?? []) {
      events.push(...(detail.events ?? []));
    }
    for (const child of n.children ?? []) visit(child);
  }
  visit(node);
  return tokenChunksFromEvents(events);
}

type TokenChunkEvent = Pick<
  ObservabilitySpanEventSummary,
  "name" | "timestamp" | "attributes"
>;

/**
 * Extract ordered token text chunks from lazy span-event responses.
 *
 * `token.chunk` uses `attributes.text`; the legacy `delta` fallback keeps old
 * local databases readable while the UI consumes the stable chunk vocabulary.
 */
export function tokenChunksFromEvents(
  events: readonly TokenChunkEvent[],
): readonly string[] {
  return events
    .flatMap((event) => {
      if (event.name !== "token.chunk") return [];
      const attrs = event.attributes as
        | Record<string, unknown>
        | null
        | undefined;
      const text =
        typeof attrs?.text === "string"
          ? attrs.text
          : typeof attrs?.delta === "string"
            ? attrs.delta
            : "";
      if (!text) return [];
      const rawOrder = attrs?.chunkIndex;
      const order =
        typeof rawOrder === "number" ? rawOrder : Number.MAX_SAFE_INTEGER;
      return [{ order, timestamp: event.timestamp, text }];
    })
    .sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.timestamp !== b.timestamp)
        return a.timestamp < b.timestamp ? -1 : 1;
      return 0;
    })
    .map((event) => event.text);
}

/** Resolve the messages artifact (chat history) for display. */
export interface ChatMessage {
  role?: string;
  content?: unknown;
  name?: string;
}

export function resolveMessages(node: ObservabilityRunDetailNode | undefined): {
  messages: readonly ChatMessage[];
  system?: string;
  prompt?: string;
  input?: unknown;
} {
  if (!node) return { messages: [] };

  // Prefer inspection.messages — backend-curated, already unwrapped.
  const insp = inspectionOf(node);
  if (insp?.messages && insp.messages.length > 0) {
    const data = insp.messages[0].data;
    if (Array.isArray(data)) return { messages: data as ChatMessage[] };
    if (data && typeof data === "object") {
      const obj = data as {
        input?: unknown;
        messages?: unknown;
        system?: unknown;
        prompt?: unknown;
      };
      return {
        messages: Array.isArray(obj.messages)
          ? (obj.messages as ChatMessage[])
          : [],
        system: typeof obj.system === "string" ? obj.system : undefined,
        prompt: typeof obj.prompt === "string" ? obj.prompt : undefined,
        input: obj.input,
      };
    }
  }

  // Look on node + details + descendants
  let preview: unknown = null;
  function walk(n: ObservabilityRunDetailNode) {
    if (preview != null) return;
    for (const art of n.artifacts ?? []) {
      if (art.kind === "messages" && art.preview != null) {
        preview = art.preview;
        return;
      }
    }
    for (const d of n.details ?? []) {
      for (const art of d.artifacts ?? []) {
        if (art.kind === "messages" && art.preview != null) {
          preview = art.preview;
          return;
        }
      }
    }
    for (const c of n.children ?? []) {
      walk(c);
      if (preview != null) return;
    }
  }
  walk(node);
  if (preview == null) return { messages: [] };
  if (Array.isArray(preview)) return { messages: preview as ChatMessage[] };
  if (typeof preview === "object") {
    const obj = preview as {
      input?: unknown;
      messages?: unknown;
      system?: unknown;
      prompt?: unknown;
    };
    return {
      messages: Array.isArray(obj.messages)
        ? (obj.messages as ChatMessage[])
        : [],
      system: typeof obj.system === "string" ? obj.system : undefined,
      prompt: typeof obj.prompt === "string" ? obj.prompt : undefined,
      input: obj.input,
    };
  }
  return { messages: [] };
}

export function findAttribute(
  node: ObservabilityRunDetailNode | undefined,
  ...keys: readonly string[]
): unknown {
  if (!node) return undefined;
  const attrs = node.attributes as Record<string, unknown> | null | undefined;
  if (attrs) {
    for (const k of keys) {
      if (attrs[k] !== undefined && attrs[k] !== null) return attrs[k];
    }
  }
  return undefined;
}

export function findNode(
  node: ObservabilityRunDetailNode,
  id: string | null,
): ObservabilityRunDetailNode | null {
  if (!id) return null;
  if (node.id === id || node.spanId === id) return node;
  for (const detail of node.details ?? []) {
    if (detail.id === id || detail.spanId === id) {
      return detailAsLeafNode(detail, node);
    }
  }
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

export function parsePartSource(source: string): {
  kind: "context" | "prompt";
  id: string;
} {
  if (source.startsWith("prompt:"))
    return { kind: "prompt", id: source.slice("prompt:".length) };
  if (source.startsWith("context:"))
    return { kind: "context", id: source.slice("context:".length) };
  return { kind: "context", id: source };
}
