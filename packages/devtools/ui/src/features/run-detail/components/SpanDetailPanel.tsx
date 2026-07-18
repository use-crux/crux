/**
 * Editorial detail pane for the span selected in the Run Inspect waterfall.
 *
 * Drives a primitive-aware view: the inner tab strip and renderers adapt
 * to what the selected node actually is. A generation has a full
 * Context / Tools / Retrieval / Scores / Citations / Metadata strip; a
 * tool.call collapses to Args / Result / Metadata; a memory operation
 * shows snapshots and writes; a handoff shows from/to and payload. The
 * V4 design's "Input + Messages" tabs collapse into a single Context tab
 * that renders the full context-composition view (prompt definition,
 * stacked-bar parts, dropped/excluded, tool inventory, user prompt) when
 * the selected span has `trace.inspect` data.
 *
 * Citations remain a "pending backend projection" stub unless a
 * `citation.report` artifact is present (per CLIENT_SERVER_BOUNDARY §2).
 * Same for the Expected side of the Output tab's diff frame.
 */

import { useMemo, useState, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import { JsonTree } from "@/shared/components/JsonTree";
import { Chip, Eyebrow, Kpi, type ChipTone } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import { SectionErrorBoundary } from "@/devtools/shell/SectionBoundary";
import {
  StreamingChunks,
  StreamingMeta,
  hasLiveStream,
  tokenizedTextCount,
} from "./StreamingChunks";
import {
  CardShell,
  EmptyHint,
  KeyValue,
  PendingFromBackend,
} from "./SpanDetailPanelAtoms";
import { OutputModeToggle, OutputTextView } from "./SpanDetailOutputRenderers";
import { useNavigation } from "@/app/navigation/useNavigation";
import { useObservabilitySpanEvents } from "@/features/observability/hooks/useObservabilityGraph";
import type {
  ObservabilityRunDetail,
  ObservabilityRunDetailNode,
  JudgeEventData,
  Trace,
  InspectPart,
  DroppedContext,
  ExcludedContext,
  CorrelatedEvent,
} from "@/types";

// ─── Tab strip ──────────────────────────────────────────────────────

import { primitiveAccentVar } from "../lib/families";
import {
  COMPOSITION_PALETTE,
  TAB_LABEL,
  asString,
  classifyPrimitive,
  findAllArtifacts,
  findArtifact,
  findArtifactDeep,
  findAttribute,
  findNode,
  finishReasonsFor,
  fmtCost,
  fmtDuration,
  fmtTokens,
  gatherDescendants,
  gatherResolvedContexts,
  inspectionOf,
  nodeCost,
  nodeDuration,
  nodeTokens,
  parsePartSource,
  providedToolsForNode,
  readMetric,
  readMetricDeep,
  resolveMessages,
  resolveModels,
  resolveOutput,
  resolveSpanError,
  shortModelId,
  statusLabel,
  statusTone,
  tabsForKind,
  tokenChunks,
  tokenChunksFromEvents,
  tokensPerSecond,
  unwrapOutput,
  type InspectionItem,
  type InspectTabId,
  type ModelUse,
  type OutputRenderMode,
  type PrimitiveKind,
  type ResolvedContext,
  type ResolvedOutput,
  type ResolvedSpanError,
} from "../lib/span-detail-inspection";
import { retrievalEntries } from "../lib/span-detail-retrieval";
import {
  collectToolRequests,
  resolveToolPayload,
} from "../lib/span-detail-tool";
import { memoryRenderBudgetDecision } from "../lib/memory-span-detail";
import {
  AgentCard,
  CompositionCard,
  EvalCard,
  EvalRunCard,
  FlowCard,
  OperationReportCard,
} from "./PrimitiveCards";
import { DeferredWorkCard } from "./DeferredWorkCard";
import { GenerationDetail } from "./GenerationDetail";
import { MediaRunPanel } from "./MediaRunPanel";
import { projectMediaRunFromNode } from "../lib/media-run-from-node";
import { RunInsight } from "./explain/RunInsight";
import { collectTurnReports } from "@/features/run-detail/lib/explain/rollup";
import {
  ContextComposition,
  hasContextContributions,
} from "./ContextComposition";
import { McpPreparationNode, McpToolOrigin } from "./McpPreparation";
import { mcpToolOrigin } from "../lib/mcp";
import { useProjectDefinitionIds } from "@/shared/query/useProjectDefinitionIds";

// ─── Card primitives ────────────────────────────────────────────────

// ─── Output tab (generation / agent / run) ──────────────────────────

function SpanErrorCard({ error }: { error: ResolvedSpanError }) {
  const meta = [
    error.category ? ["category", error.category] : null,
    error.code ? ["code", error.code] : null,
    error.phase ? ["phase", error.phase] : null,
    error.retryable != null ? ["retryable", String(error.retryable)] : null,
  ].filter((row): row is [string, string] => row != null);

  return (
    <CardShell
      label={
        <span className="flex items-center gap-2">
          <Icon name="alert" size={12} color="var(--devtools-danger)" />
          <span>Error</span>
        </span>
      }
      right={
        error.name ? (
          <span
            className="font-mono text-[10.5px]"
            style={{ color: "var(--devtools-danger)" }}
          >
            {error.name}
          </span>
        ) : undefined
      }
    >
      <div className="px-3.5 py-3">
        <div
          className="font-mono text-[12.5px] font-semibold"
          style={{ color: "var(--devtools-danger)" }}
        >
          {error.summary}
        </div>

        {meta.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {meta.map(([key, value]) => (
              <KeyValue key={key} k={key} v={value} />
            ))}
          </div>
        )}

        {error.stack && (
          <pre
            className="mt-2 max-h-[220px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11px]"
            style={{
              background: "var(--devtools-bg-muted)",
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg-muted)",
            }}
          >
            {error.stack}
          </pre>
        )}

        {error.evidence.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            <Eyebrow>Evidence</Eyebrow>
            {error.evidence.map((item) => (
              <div
                key={`${item.kind ?? item.label}:${item.preview}`}
                className="rounded-[6px] px-2.5 py-1.5 font-mono text-[11px]"
                style={{
                  background: "var(--devtools-bg-muted)",
                  border: "1px solid var(--devtools-border)",
                }}
              >
                <div style={{ color: "var(--devtools-danger)" }}>{item.label}</div>
                <div
                  className="mt-1 break-words"
                  style={{ color: "var(--devtools-fg-muted)" }}
                >
                  {item.preview}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardShell>
  );
}

function OutputTab({
  node,
  trace,
  isRoot,
  lazyTokenChunks,
}: {
  node: ObservabilityRunDetailNode;
  trace: Trace | undefined;
  isRoot: boolean;
  lazyTokenChunks: readonly string[];
}) {
  const errorArt =
    findArtifact(node, "error.stack") ?? findArtifact(node, "error.raw");
  const resolved = useMemo(
    () => resolveOutput(node, trace, isRoot),
    [node, trace, isRoot],
  );
  const spanError = useMemo(() => resolveSpanError(node), [node]);
  const [outputMode, setOutputMode] = useState<OutputRenderMode>("raw");
  const modelInfo = useMemo(() => {
    if (!resolved.owner) return null;
    const ms = resolveModels(resolved.owner);
    return ms[0] ?? null;
  }, [resolved.owner]);
  const fallbackText = resolved.text;
  const obj = resolved.text == null ? resolved.object : undefined;
  const ownerInfo =
    resolved.owner && resolved.owner.id !== node.id
      ? `from ${resolved.owner.display?.label ?? resolved.owner.name ?? resolved.owner.primitive}`
      : null;

  // Pull metrics from the *owner* of the resolved output (e.g. the
  // generation.call that actually produced this text), falling back to the
  // selected node + run-level trace projection.
  const metricSource = resolved.owner ?? node;
  const usageMeta = resolved.meta?.usage as Record<string, number> | undefined;
  const totalTokens =
    readMetric(metricSource, "totalTokens") ??
    readMetricDeep(metricSource, "totalTokens") ??
    (typeof usageMeta?.totalTokens === "number"
      ? usageMeta.totalTokens
      : undefined) ??
    (typeof usageMeta?.outputTokens === "number"
      ? usageMeta.outputTokens
      : undefined);
  const inputTok =
    readMetric(metricSource, "inputTokens") ??
    (typeof usageMeta?.inputTokens === "number"
      ? usageMeta.inputTokens
      : undefined);
  const outputTok =
    readMetric(metricSource, "outputTokens") ??
    (typeof usageMeta?.outputTokens === "number"
      ? usageMeta.outputTokens
      : undefined);
  const cachedTok =
    readMetric(metricSource, "cachedInputTokens") ??
    readMetric(metricSource, "cacheReadTokens");
  const reasoningTok = readMetric(metricSource, "reasoningTokens");
  const costN =
    readMetric(metricSource, "cost") ??
    readMetric(metricSource, "costUsd") ??
    resolved.meta?.cost ??
    trace?.result?.cost;
  const cost = fmtCost(costN);
  const tokens = fmtTokens(totalTokens);
  const tps = tokensPerSecond(metricSource);
  const finishReason =
    (findAttribute(metricSource, "finishReason") as string | undefined) ??
    resolved.meta?.finishReason ??
    trace?.result?.finishReason;
  const eventChunks = useMemo(() => tokenChunks(node), [node]);
  const traceChunks = isRoot ? (trace?.streamProgress?.chunks ?? []) : [];
  const streamChunks =
    lazyTokenChunks.length > 0
      ? lazyTokenChunks
      : eventChunks.length > 0
        ? eventChunks
        : traceChunks;
  const streamTextLength = streamChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0,
  );
  const isStreaming =
    node.status === "running" || (trace?.status === "running" && isRoot);
  const hasStream =
    streamChunks.length > 0 || (isRoot && !!trace && hasLiveStream(trace));

  return (
    <div className="flex flex-col gap-4">
      {spanError && <SpanErrorCard error={spanError} />}

      {!spanError && trace?.error && isRoot && (
        <CardShell label="Error">
          <div className="px-3.5 py-3" style={{ color: "var(--devtools-danger)" }}>
            <div className="font-mono text-[12.5px] font-semibold">
              {trace.error.message}
            </div>
            {trace.error.category && (
              <div
                className="mt-1 font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                category · {trace.error.category}
              </div>
            )}
            {trace.error.stack && (
              <pre
                className="mt-2 max-h-[200px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11px]"
                style={{
                  background: "var(--devtools-bg-muted)",
                  border: "1px solid var(--devtools-border)",
                  color: "var(--devtools-fg-muted)",
                }}
              >
                {trace.error.stack}
              </pre>
            )}
          </div>
        </CardShell>
      )}

      {hasStream && (
        <CardShell
          label={isStreaming ? "Live stream" : "Stream replay"}
          right={
            <span style={{ color: "var(--devtools-fg-muted)" }}>
              {streamChunks.length} chunks ·{" "}
              {tokenizedTextCount(undefined, streamChunks).toLocaleString()}{" "}
              tokens ·{" "}
              {(
                trace?.streamProgress?.textLength ?? streamTextLength
              ).toLocaleString()}{" "}
              chars
              {trace?.streamProgress?.ttftMs != null
                ? ` · TTFT ${trace.streamProgress.ttftMs}ms`
                : ""}
            </span>
          }
        >
          <div className="px-3.5 py-3">
            {isStreaming && (
              <StreamingMeta
                chunksReceived={streamChunks.length}
                textLength={
                  trace?.streamProgress?.textLength ?? streamTextLength
                }
                ttftMs={trace?.streamProgress?.ttftMs}
                elapsedMs={trace?.streamProgress?.elapsedMs}
              />
            )}
            <div className={isStreaming ? "mt-3" : ""}>
              <StreamingChunks
                chunks={streamChunks}
                isStreaming={isStreaming}
                maxHeight={420}
              />
            </div>
          </div>
        </CardShell>
      )}

      <CardShell
        label="Output"
        right={
          <span className="flex items-center gap-2">
            {fallbackText && (
              <OutputModeToggle
                mode={outputMode}
                onModeChange={setOutputMode}
              />
            )}
            {ownerInfo && (
              <span
                className="font-mono"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {ownerInfo}
              </span>
            )}
            {modelInfo && (modelInfo.provider || modelInfo.model) && (
              <span
                className="font-mono"
                style={{ color: "var(--devtools-iris)" }}
                title={modelInfo.model}
              >
                {[modelInfo.provider, shortModelId(modelInfo.model)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
            <span>
              {[
                tokens !== "—" ? tokens : "",
                inputTok != null && outputTok != null
                  ? `(${fmtTokens(inputTok)}↓ / ${fmtTokens(outputTok)}↑${cachedTok ? ` · ${fmtTokens(cachedTok)} cached` : ""}${reasoningTok ? ` · ${fmtTokens(reasoningTok)} reason` : ""})`
                  : "",
                cost !== "—" ? cost : "",
                tps != null ? `${tps.toFixed(1)}t/s` : "",
                finishReason ?? "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
        }
      >
        <div
          className="px-3.5 py-3 text-[13.5px] leading-[1.65]"
          style={{ fontFamily: "var(--devtools-serif)" }}
        >
          {fallbackText ? (
            <OutputTextView text={fallbackText} mode={outputMode} />
          ) : obj ? (
            <div>
              <JsonTree data={obj as unknown} />
            </div>
          ) : errorArt?.preview != null ? (
            <pre
              className="m-0 max-h-[360px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11.5px]"
              style={{
                background: "var(--devtools-bg-muted)",
                border: "1px solid var(--devtools-border)",
                color: "var(--devtools-danger)",
              }}
            >
              {asString(errorArt.preview)}
            </pre>
          ) : (
            <span style={{ color: "var(--devtools-fg-faint)" }}>
              (no output for this span)
            </span>
          )}
        </div>
      </CardShell>

      {/* Generated tool calls + reasoning (the model's output parts) */}
      <GeneratedOutputParts node={node} />

      {/* Grounding — citations live in the Output pane (spec §4) */}
      <OutputGrounding node={node} />

      {/* Fallback attempts */}
      {isRoot && trace?.fallback && trace.fallback.details.length > 0 && (
        <div>
          <Eyebrow>
            Fallback · {trace.fallback.attempts} attempt
            {trace.fallback.attempts === 1 ? "" : "s"}
          </Eyebrow>
          <div className="mt-2 flex flex-col gap-2">
            {trace.fallback.details.map((d, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-[6px] px-3 py-2 font-mono text-[11.5px]"
                style={{
                  background: "var(--devtools-bg-elev)",
                  border: "1px solid var(--devtools-border)",
                }}
              >
                <Chip tone={d.status === "success" ? "ok" : "danger"} dot>
                  {d.status}
                </Chip>
                <span style={{ color: "var(--devtools-fg)" }}>{d.model}</span>
                <span style={{ color: "var(--devtools-fg-muted)" }}>
                  {fmtDuration(d.durationMs)}
                </span>
                {d.cost != null && (
                  <span style={{ color: "var(--devtools-fg-muted)" }}>
                    · {fmtCost(d.cost)}
                  </span>
                )}
                {d.error && (
                  <span
                    className="truncate"
                    style={{ color: "var(--devtools-danger)" }}
                  >
                    {d.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Generated tool calls + reasoning — the model's output content parts,
 *  folded into the Output pane (spec §4). Renders only when the messages
 *  artifact carries assistant content-parts (not role-based input messages). */
function GeneratedOutputParts({ node }: { node: ObservabilityRunDetailNode }) {
  const msgs = useMemo(() => resolveMessages(node).messages, [node]);
  const allParts =
    msgs.length > 0 && msgs.every((m) => isContentPart(m as AnyMessageItem));
  if (!allParts) return null;
  return (
    <MessageBlock
      raw={msgs as unknown}
      label={`Generated · ${msgs.length} parts`}
    />
  );
}

/** In-pane grounding list — citation markers resolved against the source pool
 *  (spec §4: the grounded-vs-ungrounded summary lives in the Output pane). */
function OutputGrounding({ node }: { node: ObservabilityRunDetailNode }) {
  const report = findArtifact(node, "citation.report")?.preview;
  const markers =
    report &&
    typeof report === "object" &&
    (report as { kind?: unknown }).kind === "citation.report"
      ? ((report as { markers?: ReadonlyArray<Record<string, unknown>> })
          .markers ?? [])
      : [];
  if (markers.length === 0) return null;
  const grounded = markers.filter((m) => m.grounded === true).length;
  return (
    <CardShell
      label="Grounding"
      right={
        <Chip tone={grounded === markers.length ? "ok" : "warn"} dot>
          {grounded} / {markers.length} cited
        </Chip>
      }
    >
      <div
        className="flex flex-col gap-px"
        style={{ background: "var(--devtools-border)" }}
      >
        {markers.map((m, i) => {
          const sourceId =
            typeof m.sourceId === "string"
              ? m.sourceId
              : typeof m.chunkId === "string"
                ? m.chunkId
                : "—";
          const score = typeof m.score === "number" ? m.score : undefined;
          const isGrounded = m.grounded === true;
          const marker = m.marker;
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 px-3.5 py-1.5 font-mono text-[11.5px]"
              style={{
                background: "var(--devtools-bg-elev)",
                opacity: isGrounded ? 1 : 0.7,
              }}
            >
              <span
                style={{
                  color: isGrounded ? "var(--devtools-crux)" : "var(--devtools-fg-faint)",
                  width: 26,
                }}
              >
                {marker != null ? `[${String(marker)}]` : "—"}
              </span>
              <span
                className="flex-1 truncate"
                style={{ color: "var(--devtools-fg-muted)" }}
                title={sourceId}
              >
                {sourceId}
              </span>
              {isGrounded && score != null ? (
                <Chip tone="ok" mono>
                  {score.toFixed(2)}
                </Chip>
              ) : (
                <Chip tone="warn">
                  {typeof m.note === "string" ? m.note : "unused"}
                </Chip>
              )}
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}

// ─── Context tab (the full context-engineering view) ─────────────────

function ContextTab({
  node,
  trace,
  isRoot,
}: {
  node: ObservabilityRunDetailNode;
  trace: Trace | undefined;
  isRoot: boolean;
}) {
  const { navigate } = useNavigation();

  // Gather resolved contexts from detail nodes (the new backend's source
  // of truth — each context.resolve detail carries its text + priority).
  const contexts = useMemo(() => gatherResolvedContexts(node), [node]);
  const messages = useMemo(() => resolveMessages(node), [node]);

  // Tool inventory comes from trace.inspect (legacy) when present, or we
  // derive it from tool.call descendants.
  const toolsFromInspect = trace?.inspect?.tools ?? [];
  const toolsFromDescendants = useMemo(() => {
    const set = new Set<string>();
    function walk(n: ObservabilityRunDetailNode) {
      if (n.toolName) set.add(n.toolName);
      for (const c of n.children ?? []) walk(c);
    }
    walk(node);
    return Array.from(set);
  }, [node]);
  const tools =
    toolsFromInspect.length > 0 ? toolsFromInspect : toolsFromDescendants;

  const rootInput = isRoot ? trace?.input : undefined;
  const userInput = messages.input ?? rootInput;

  const withText = contexts.filter((c) => c.text);
  const predicateOnly = contexts.filter((c) => c.hasPredicate && !c.text);
  const composed = withText.length > 0;
  const totalSize = withText.reduce((a, c) => a + (c.sizeBytes ?? 0), 0);
  const colorFor = (idx: number) =>
    COMPOSITION_PALETTE[idx % COMPOSITION_PALETTE.length];
  const visibleTotal = Math.max(1, totalSize);
  // Prefer the backend's typed context.contribution / prompt.budget pane (§9)
  // when present; otherwise fall back to the resolved-context view below.
  const contributionsPresent = hasContextContributions(node);

  if (
    !contributionsPresent &&
    contexts.length === 0 &&
    messages.messages.length === 0 &&
    !messages.system &&
    !messages.prompt &&
    !userInput
  ) {
    return (
      <EmptyHint>
        No context composition captured for this span. (Context is recorded at
        the prompt-resolve / generation layer — tool calls, memory writes, and
        handoffs don't usually carry one.)
      </EmptyHint>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {contributionsPresent && <ContextComposition node={node} />}
      {!contributionsPresent && composed && (
        <>
          <Eyebrow>
            Context composition · {withText.length} resolved
            {predicateOnly.length > 0
              ? ` · ${predicateOnly.length} checked`
              : ""}
            {totalSize > 0 ? ` · ${(totalSize / 1024).toFixed(1)}kB` : ""}
          </Eyebrow>

          <CardShell
            label="Composition"
            right={`${withText.length} active${predicateOnly.length > 0 ? ` · ${predicateOnly.length} skipped` : ""}`}
          >
            <div className="px-3.5 py-3">
              <div
                className="flex h-3 w-full overflow-hidden rounded-[4px]"
                style={{ background: "var(--devtools-bg-muted)" }}
              >
                {withText.map((c, i) => {
                  const w = ((c.sizeBytes ?? 0) / visibleTotal) * 100;
                  if (w <= 0) return null;
                  return (
                    <div
                      key={c.label + i}
                      title={`${c.label} · ${c.sizeBytes ?? 0} bytes${c.priority != null ? ` · priority ${c.priority}` : ""}`}
                      style={{
                        width: `${w}%`,
                        background: colorFor(i),
                        boxShadow: "inset 0 0 0 1px var(--devtools-bg-elev)",
                      }}
                    />
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {withText.map((c, i) => (
                  <button
                    key={c.label + i}
                    onClick={() =>
                      navigate(
                        c.family === "prompt"
                          ? { view: "library-index", promptId: c.label }
                          : { view: "library-index", contextId: c.label },
                      )
                    }
                    className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                    style={{
                      background: "var(--devtools-bg-muted)",
                      color: "var(--devtools-fg)",
                      boxShadow: "inset 0 0 0 1px var(--devtools-border)",
                    }}
                    title={`Open ${c.family} · ${c.label}`}
                  >
                    <span
                      className="size-2 rounded-[2px]"
                      style={{ background: colorFor(i) }}
                    />
                    {c.label}
                    {c.priority != null && (
                      <span style={{ color: "var(--devtools-fg-faint)" }}>
                        p{c.priority}
                      </span>
                    )}
                    {c.sizeBytes != null && (
                      <span style={{ color: "var(--devtools-fg-faint)" }}>
                        {(c.sizeBytes / 1024).toFixed(1)}kB
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </CardShell>

          <div className="flex flex-col gap-2">
            <Eyebrow>Parts · {withText.length}</Eyebrow>
            {withText.map((c, i) => (
              <ResolvedContextCard
                key={c.label + i}
                entry={c}
                color={colorFor(i)}
              />
            ))}
          </div>
        </>
      )}

      {!contributionsPresent && predicateOnly.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Checked but not included · {predicateOnly.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {predicateOnly.map((c) => (
              <span
                key={c.label}
                className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: "var(--devtools-bg-muted)",
                  color: "var(--devtools-fg-muted)",
                  border: "1px dashed var(--devtools-border)",
                }}
                title={`Predicate-only · ${c.label}`}
              >
                {c.label}
                {c.priority != null && (
                  <span style={{ color: "var(--devtools-fg-faint)" }}>
                    p{c.priority}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {tools.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool inventory · {tools.length}</Eyebrow>
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <button
                key={t}
                onClick={() => navigate({ view: "library-index", toolName: t })}
                className="rounded-[4px] px-2 py-0.5 font-mono text-[11px] transition-opacity hover:opacity-90"
                style={{
                  background: "var(--devtools-bg-muted)",
                  color: "var(--devtools-fg)",
                  boxShadow: "inset 0 0 0 1px var(--devtools-border)",
                }}
                title={`Open tool · ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {messages.system && !composed && !contributionsPresent && (
        <CardShell label="System">
          <div
            className="px-3.5 py-3 whitespace-pre-wrap text-[12.5px] leading-[1.55]"
            style={{ color: "var(--devtools-fg)", fontFamily: "var(--devtools-serif)" }}
          >
            {messages.system}
          </div>
        </CardShell>
      )}
      {messages.prompt && (
        <div className="flex flex-col gap-2">
          <Eyebrow>User · prompt</Eyebrow>
          <div
            className="rounded-[10px] px-4 py-3 text-[14px] leading-[1.6]"
            style={{
              background: "var(--devtools-bg-muted)",
              border: "1px solid var(--devtools-border)",
              fontFamily: "var(--devtools-serif)",
            }}
          >
            <div className="devtools-prose">
              <Streamdown>{messages.prompt}</Streamdown>
            </div>
          </div>
        </div>
      )}
      {(() => {
        // The Context tab shows the *input* thread (system/user/prior turns).
        // Assistant output content-parts (reasoning/tool-calls) belong in the
        // Output pane (spec §4) — `GeneratedOutputParts` renders them there.
        const inputMessages = messages.messages.filter(
          (m) =>
            !(
              m != null &&
              typeof m === "object" &&
              typeof (m as { type?: unknown }).type === "string" &&
              (m as { role?: unknown }).role === undefined
            ),
        );
        if (inputMessages.length === 0) return null;
        return (
          <div className="flex flex-col gap-2">
            <Eyebrow>Messages · {inputMessages.length}</Eyebrow>
            <MessageBlock raw={inputMessages as unknown} />
          </div>
        );
      })()}
      {userInput != null &&
        !(
          typeof userInput === "object" &&
          userInput != null &&
          !Array.isArray(userInput) &&
          Object.keys(userInput as Record<string, unknown>).length === 0
        ) && (
          <CardShell label="Input">
            <div className="px-3.5 py-3">
              <JsonTree data={userInput as unknown} />
            </div>
          </CardShell>
        )}
    </div>
  );
}

function ResolvedContextCard({
  entry,
  color,
}: {
  entry: ResolvedContext;
  color: string;
}) {
  const { navigate } = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const text = entry.text ?? "";
  const truncated = text.length > 400;
  const shown = expanded || !truncated ? text : text.slice(0, 400) + "…";
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
        borderLeft: `3px solid ${color}`,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3.5 py-2"
        style={{
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg-muted)",
        }}
      >
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {entry.family}
        </span>
        <button
          onClick={() =>
            navigate(
              entry.family === "prompt"
                ? { view: "library-index", promptId: entry.label }
                : { view: "library-index", contextId: entry.label },
            )
          }
          className="font-mono text-[12px] transition-colors hover:underline"
          style={{ color: "var(--devtools-crux)" }}
          title={`Open ${entry.family} · ${entry.label}`}
        >
          {entry.label}
        </button>
        {entry.priority != null && (
          <Chip tone="muted" mono>
            p{entry.priority}
          </Chip>
        )}
        <span
          className="ml-auto font-mono text-[10.5px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {entry.sizeBytes != null
            ? `${(entry.sizeBytes / 1024).toFixed(1)}kB`
            : ""}
          {entry.durationMs != null
            ? ` · ${fmtDuration(entry.durationMs)}`
            : ""}
        </span>
      </div>
      {text ? (
        <>
          <div
            className="whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-[1.55]"
            style={{ fontFamily: "var(--devtools-serif)" }}
          >
            {shown}
          </div>
          {truncated && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="block w-full px-3.5 py-2 text-left font-mono text-[11px]"
              style={{
                color: "var(--devtools-crux)",
                borderTop: "1px solid var(--devtools-border)",
                background: "var(--devtools-bg-muted)",
              }}
            >
              {expanded ? "↑ collapse" : "↓ expand"}
            </button>
          )}
        </>
      ) : entry.body != null ? (
        <div className="px-3.5 py-3">
          <JsonTree data={entry.body as unknown} />
        </div>
      ) : (
        <div
          className="px-3.5 py-3 text-[11.5px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          (no body recorded)
        </div>
      )}
    </div>
  );
}

function PartCard({ part, color }: { part: InspectPart; color: string }) {
  const { navigate } = useNavigation();
  const [expanded, setExpanded] = useState(false);
  const truncated = part.text.length > 400;
  const text =
    expanded || !truncated ? part.text : part.text.slice(0, 400) + "…";
  const parsed = parsePartSource(part.source);
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
        borderLeft: `3px solid ${color}`,
        opacity: part.skipped ? 0.65 : 1,
      }}
    >
      <div
        className="flex flex-wrap items-center gap-2 px-3.5 py-2"
        style={{
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg-muted)",
        }}
      >
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.08em]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          system
        </span>
        <button
          onClick={() =>
            navigate(
              parsed.kind === "prompt"
                ? { view: "library-index", promptId: parsed.id }
                : { view: "library-index", contextId: parsed.id },
            )
          }
          className="font-mono text-[12px] transition-colors hover:underline"
          style={{ color: "var(--devtools-crux)" }}
          title={`Open ${parsed.kind} · ${parsed.id}`}
        >
          {part.source}
        </button>
        {part.skipped && <Chip tone="muted">skipped</Chip>}
        <span
          className="ml-auto font-mono text-[10.5px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {fmtTokens(part.tokens)} tok
        </span>
      </div>
      <div
        className="whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-[1.55]"
        style={{ fontFamily: "var(--devtools-serif)" }}
      >
        {text}
      </div>
      {truncated && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="block w-full px-3.5 py-2 text-left font-mono text-[11px]"
          style={{
            color: "var(--devtools-crux)",
            borderTop: "1px solid var(--devtools-border)",
            background: "var(--devtools-bg-muted)",
          }}
        >
          {expanded ? "↑ collapse" : "↓ expand"}
        </button>
      )}
    </div>
  );
}

function DroppedRow({ entry }: { entry: DroppedContext }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[6px] px-3 py-1.5 font-mono text-[11.5px]"
      style={{
        background: "var(--devtools-warn-soft)",
        border: "1px solid var(--devtools-warn-soft)",
        color: "var(--devtools-warn)",
      }}
    >
      <span style={{ fontWeight: 600 }}>{entry.source}</span>
      <span style={{ color: "var(--devtools-fg-muted)" }}>
        priority {entry.priority} · {fmtTokens(entry.tokens)} tok
      </span>
      <span className="truncate" style={{ color: "var(--devtools-fg)" }}>
        {entry.text.slice(0, 160)}
      </span>
    </div>
  );
}

function ExcludedRow({ entry }: { entry: ExcludedContext }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-[6px] px-3 py-1.5 font-mono text-[11.5px]"
      style={{
        background: "var(--devtools-bg-muted)",
        border: "1px solid var(--devtools-border)",
        color: "var(--devtools-fg-muted)",
      }}
    >
      <span style={{ fontWeight: 600, color: "var(--devtools-fg)" }}>
        {entry.source}
      </span>
      <span>· {entry.reason}</span>
    </div>
  );
}

/**
 * Two distinct shapes flow through this component:
 *
 *  1. **Chat messages** — `[{ role: 'system' | 'user' | 'assistant' | 'tool',
 *     content: string | ContentPart[], name? }]`. This is the input shape
 *     fed to LLMs and used by most context-engineering layers.
 *
 *  2. **AI SDK v6 content parts** — `[{ type: 'reasoning' | 'text' |
 *     'tool-call' | 'tool-result' | 'file' | 'image', ...partFields }]`.
 *     This is the *output* shape from generation.call (the assistant's
 *     response, decomposed into reasoning blocks, text, and tool calls).
 *     It surfaces on Convex-agent-wrapped generations where the messages
 *     artifact captures the model's output rather than the input chat.
 *
 * We auto-detect: an item with `type` but no `role` is treated as a
 * content part. Otherwise we fall back to the chat-message renderer.
 * Mixed arrays (rare) are rendered row-by-row with per-row detection.
 */
type AnyMessageItem = Record<string, unknown>;

interface AssistantContentPart {
  type: string;
  text?: string;
  input?: unknown;
  output?: unknown;
  args?: unknown;
  result?: unknown;
  toolName?: string;
  toolCallId?: string;
  providerExecuted?: boolean;
  title?: string;
}

function isContentPart(item: AnyMessageItem): boolean {
  return typeof item.type === "string" && item.role === undefined;
}

function MessageBlock({ raw, label }: { raw: unknown; label?: string }) {
  const items = useMemo<AnyMessageItem[]>(() => {
    if (Array.isArray(raw)) return raw as AnyMessageItem[];
    if (typeof raw === "object" && raw !== null) {
      const list = (raw as { messages?: unknown }).messages;
      if (Array.isArray(list)) return list as AnyMessageItem[];
    }
    return [];
  }, [raw]);

  if (items.length === 0) return null;

  // If every row is a content-part, label it "Assistant output" — that's
  // what these arrays actually represent on AI-SDK generations.
  const allContentParts = items.every((m) => isContentPart(m));
  const computedLabel =
    label ??
    (allContentParts
      ? `Assistant output · ${items.length} parts`
      : `Messages · ${items.length}`);

  return (
    <CardShell label={computedLabel}>
      <div
        className="flex flex-col gap-px"
        style={{ background: "var(--devtools-border)" }}
      >
        {items.map((m, i) =>
          isContentPart(m) ? (
            <ContentPartRow
              key={i}
              part={m as unknown as AssistantContentPart}
            />
          ) : (
            <ChatMessageRow key={i} msg={m} />
          ),
        )}
      </div>
    </CardShell>
  );
}

/** One AI-SDK content part — reasoning / text / tool-call / tool-result / file / image. */
function ContentPartRow({ part }: { part: AssistantContentPart }) {
  switch (part.type) {
    case "reasoning": {
      return (
        <PartRow tone="iris" label="reasoning" icon="brain">
          <div
            className="whitespace-pre-wrap text-[12.5px] leading-[1.6]"
            style={{
              color: "var(--devtools-fg-muted)",
              fontFamily: "var(--devtools-serif)",
              fontStyle: "italic",
            }}
          >
            {part.text || (
              <span style={{ color: "var(--devtools-fg-faint)" }}>
                (empty reasoning)
              </span>
            )}
          </div>
        </PartRow>
      );
    }
    case "text": {
      return (
        <PartRow tone="crux" label="assistant" icon="spark">
          <div
            className="whitespace-pre-wrap text-[13px] leading-[1.6]"
            style={{ color: "var(--devtools-fg)", fontFamily: "var(--devtools-serif)" }}
          >
            {part.text || (
              <span style={{ color: "var(--devtools-fg-faint)" }}>(empty)</span>
            )}
          </div>
        </PartRow>
      );
    }
    case "tool-call":
    case "tool_call": {
      const args = part.input ?? part.args;
      return (
        <PartRow
          tone="warn"
          label={
            <span className="font-mono">
              tool-call
              {part.toolName && (
                <>
                  {" "}
                  <span style={{ color: "var(--devtools-warn)" }}>·</span>{" "}
                  {part.toolName}
                </>
              )}
            </span>
          }
          icon="flask"
          right={
            part.toolCallId && (
              <span
                className="font-mono text-[10.5px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {part.toolCallId}
              </span>
            )
          }
        >
          {part.title && (
            <div
              className="mb-1.5 text-[12.5px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {part.title}
            </div>
          )}
          {args != null ? (
            <div
              className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
              style={{
                background: "var(--devtools-bg)",
                border: "1px solid var(--devtools-border)",
                maxHeight: 240,
              }}
            >
              <JsonTree data={args} />
            </div>
          ) : (
            <span
              className="text-[12px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              (no args)
            </span>
          )}
        </PartRow>
      );
    }
    case "tool-result":
    case "tool_result": {
      const result = part.output ?? part.result;
      return (
        <PartRow
          tone="ok"
          label={
            <span className="font-mono">
              tool-result
              {part.toolName && (
                <>
                  {" "}
                  <span style={{ color: "var(--devtools-ok)" }}>·</span>{" "}
                  {part.toolName}
                </>
              )}
            </span>
          }
          icon="check"
          right={
            part.toolCallId && (
              <span
                className="font-mono text-[10.5px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {part.toolCallId}
              </span>
            )
          }
        >
          {result != null ? (
            typeof result === "string" ? (
              <div
                className="whitespace-pre-wrap text-[12.5px] leading-[1.55]"
                style={{ color: "var(--devtools-fg)", fontFamily: "var(--devtools-serif)" }}
              >
                {result}
              </div>
            ) : (
              <div
                className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
                style={{
                  background: "var(--devtools-bg)",
                  border: "1px solid var(--devtools-border)",
                  maxHeight: 240,
                }}
              >
                <JsonTree data={result} />
              </div>
            )
          ) : (
            <span
              className="text-[12px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              (no result)
            </span>
          )}
        </PartRow>
      );
    }
    case "file":
    case "image": {
      const url =
        (part as unknown as Record<string, unknown>).url ??
        (part as unknown as Record<string, unknown>).source;
      return (
        <PartRow tone="muted" label={part.type} icon="folder">
          <div
            className="font-mono text-[11.5px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            {typeof url === "string" ? url : asString(part)}
          </div>
        </PartRow>
      );
    }
    default: {
      // Unknown part type — surface the raw JSON so it's not silently
      // dropped. New AI-SDK parts arrive regularly; better visible than
      // invisible.
      return (
        <PartRow tone="muted" label={part.type || "part"}>
          <div
            className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
            style={{
              background: "var(--devtools-bg)",
              border: "1px solid var(--devtools-border)",
              maxHeight: 200,
            }}
          >
            <JsonTree data={part as unknown} />
          </div>
        </PartRow>
      );
    }
  }
}

function PartRow({
  tone,
  label,
  icon: _icon,
  right,
  children,
}: {
  tone: ChipTone;
  label: ReactNode;
  icon?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="px-3.5 py-3" style={{ background: "var(--devtools-bg-elev)" }}>
      <div className="mb-1.5 flex items-center gap-2">
        <Chip tone={tone}>{label}</Chip>
        <span className="ml-auto">{right}</span>
      </div>
      {children}
    </div>
  );
}

function ChatMessageRow({ msg }: { msg: AnyMessageItem }) {
  const role = (
    typeof msg.role === "string" ? msg.role : "message"
  ).toLowerCase();
  const tone: ChipTone =
    role === "system"
      ? "iris"
      : role === "assistant"
        ? "crux"
        : role === "tool"
          ? "muted"
          : "ok";
  const content = msg.content;
  // Content can be a string or an array of content parts (multimodal /
  // tool-call-bearing). Render either case clearly.
  return (
    <div className="px-3.5 py-3" style={{ background: "var(--devtools-bg-elev)" }}>
      <div className="mb-1 flex items-center gap-2">
        <Chip tone={tone}>{role}</Chip>
        {typeof msg.name === "string" && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            {msg.name}
          </span>
        )}
      </div>
      {typeof content === "string" ? (
        <div
          className="whitespace-pre-wrap text-[12.5px] leading-[1.55]"
          style={{
            fontFamily: role === "tool" ? "var(--devtools-mono)" : "var(--devtools-serif)",
          }}
        >
          {content || (
            <span style={{ color: "var(--devtools-fg-faint)" }}>(empty)</span>
          )}
        </div>
      ) : Array.isArray(content) ? (
        <div className="flex flex-col gap-2">
          {(content as AnyMessageItem[]).map((c, j) =>
            isContentPart(c) ? (
              <ContentPartRow
                key={j}
                part={c as unknown as AssistantContentPart}
              />
            ) : (
              <div
                key={j}
                className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
                style={{
                  background: "var(--devtools-bg)",
                  border: "1px solid var(--devtools-border)",
                  maxHeight: 200,
                }}
              >
                <JsonTree data={c as unknown} />
              </div>
            ),
          )}
        </div>
      ) : content != null ? (
        <div
          className="overflow-auto rounded-[6px] px-2.5 py-1.5 font-mono text-[11.5px]"
          style={{
            background: "var(--devtools-bg)",
            border: "1px solid var(--devtools-border)",
            maxHeight: 200,
          }}
        >
          <JsonTree data={content as unknown} />
        </div>
      ) : (
        <span className="text-[12px]" style={{ color: "var(--devtools-fg-faint)" }}>
          (empty)
        </span>
      )}
    </div>
  );
}

// ─── shared section header (design `SecHead`) ───────────────────────

/** Eyebrow + rule + optional right slot — the design's `SecHead`. */
function SpanSection({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>{title}</Eyebrow>
        <div
          className="h-px flex-1"
          style={{ background: "var(--devtools-border)" }}
        />
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Tool span panel (primitive === tool.*) ─────────────────────────

/** design `CardTool` "Call" box — Section header + Raw⇄Pretty toggle over a
 *  single bordered args↓ / result↑ frame. */
function ToolCallBox({
  args,
  result,
  running,
  argsNote,
  resultNote,
  resultStatus,
  resultTone,
}: {
  args: unknown;
  result: unknown;
  running: boolean;
  argsNote?: string;
  resultNote?: string;
  resultStatus: string;
  resultTone: ChipTone;
}) {
  const [mode, setMode] = useState<"pretty" | "raw">("pretty");
  const renderVal = (v: unknown, empty: ReactNode) => {
    if (v === undefined) return empty;
    if (mode === "raw") {
      return (
        <pre
          className="m-0 max-h-[360px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-[1.6]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {asString(v)}
        </pre>
      );
    }
    return <JsonTree data={v as unknown} />;
  };
  const HeaderRow = ({
    label,
    note,
    right,
  }: {
    label: string;
    note?: string;
    right?: ReactNode;
  }) => (
    <div
      className="flex items-center justify-between px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em]"
      style={{
        color: "var(--devtools-fg-faint)",
        background: "var(--devtools-bg-muted)",
        borderBottom: "1px solid var(--devtools-border)",
      }}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2 normal-case">
        {note && <span style={{ color: "var(--devtools-fg-faint)" }}>{note}</span>}
        {right}
      </span>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <Eyebrow>Call</Eyebrow>
        <div
          className="h-px flex-1"
          style={{ background: "var(--devtools-border)" }}
        />
        <div
          className="inline-flex overflow-hidden rounded-[6px] font-mono text-[10.5px]"
          style={{ boxShadow: "inset 0 0 0 1px var(--devtools-border)" }}
        >
          {(["pretty", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="px-2.5 py-[3px]"
              style={{
                background: mode === m ? "var(--devtools-crux-soft)" : "transparent",
                color: mode === m ? "var(--devtools-crux)" : "var(--devtools-fg-faint)",
                fontWeight: mode === m ? 600 : 450,
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div
        className="overflow-hidden rounded-[8px]"
        style={{ border: "1px solid var(--devtools-border)" }}
      >
        <HeaderRow label="args ↓" note={argsNote} />
        <div className="px-3.5 py-3">
          {renderVal(
            args,
            <span
              className="text-[12px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              (args not recorded — the model embeds them in the parent
              generation's messages artifact)
            </span>,
          )}
        </div>
        <HeaderRow
          label="result ↑"
          note={resultNote}
          right={
            <Chip tone={resultTone} mono>
              {resultStatus}
            </Chip>
          }
        />
        <div className="px-3.5 py-3">
          {renderVal(
            result,
            <span
              className="text-[12px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              {running ? "running…" : "(no result recorded)"}
            </span>,
          )}
        </div>
      </div>
    </div>
  );
}

function ToolSpanTab({
  node,
  onSelectSpan,
}: {
  node: ObservabilityRunDetailNode;
  onSelectSpan?: (id: string) => void;
}) {
  // Identity (toolName · callId · status) renders in `SelectedSpanHeader`.
  const toolCallId = findAttribute(node, "toolCallId") as string | undefined;
  const payload = useMemo(() => resolveToolPayload(node), [node]);
  const spanError = useMemo(() => resolveSpanError(node), [node]);
  const approvalArt =
    findArtifact(node, "security.report") ??
    findArtifact(node, "guardrail.report") ??
    findArtifact(node, "constraint.report");
  const knownDefinitionIds = useProjectDefinitionIds();
  const mcpOrigin = mcpToolOrigin(node, knownDefinitionIds);
  const { navigate } = useNavigation();

  // Cross-link to the requesting generation via tool.request item
  const insp = inspectionOf(node);
  const requestItem = insp?.tools?.find((i) => i.kind === "tool.request");
  const requestingSpanId = requestItem?.sourceSpanId;
  const argsOwnerInfo =
    payload.argsOwner && payload.argsOwner.id !== node.id
      ? `from ${payload.argsOwner.display?.label ?? payload.argsOwner.name ?? payload.argsOwner.primitive}`
      : null;
  const resultOwnerInfo =
    payload.resultOwner && payload.resultOwner.id !== node.id
      ? `from ${payload.resultOwner.display?.label ?? payload.resultOwner.name ?? payload.resultOwner.primitive}`
      : null;

  return (
    <div className="flex flex-col gap-3">
      {spanError && <SpanErrorCard error={spanError} />}

      {mcpOrigin && (
        <McpToolOrigin
          origin={mcpOrigin}
          onOpenCatalog={(definitionId) =>
            navigate({ view: "library-index", promptId: definitionId })
          }
          onSelectSpan={onSelectSpan}
        />
      )}

      {/* design `CardTool` center: a "Call" section (Raw⇄Pretty) over one
          bordered args↓ / result↑ box. Identity/status live in the header;
          approval/index facts live in the Inspector. */}
      <ToolCallBox
        args={payload.args}
        result={payload.result}
        running={node.status === "running"}
        argsNote={
          [
            argsOwnerInfo,
            payload.inputSize != null
              ? `${payload.inputSize.toLocaleString()} B`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        resultNote={
          [
            resultOwnerInfo,
            payload.outputSize != null
              ? `${payload.outputSize.toLocaleString()} B`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        resultStatus={statusLabel(node.status)}
        resultTone={statusTone(node.status)}
      />

      {requestingSpanId && (
        <CardShell label="Request">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            <KeyValue k="requestedBy" v={requestingSpanId} />
            {toolCallId && <KeyValue k="toolCallId" v={toolCallId} />}
          </div>
        </CardShell>
      )}

      {(payload.fromAgent || payload.toAgent || payload.delegateId) && (
        <CardShell label="Handoff">
          <div className="flex flex-col gap-1.5 px-3.5 py-3">
            {(payload.fromAgent || payload.toAgent) && (
              <KeyValue
                k="agents"
                v={`${payload.fromAgent ?? "—"} → ${payload.toAgent ?? "—"}`}
              />
            )}
            {payload.delegateId && (
              <KeyValue k="delegateId" v={payload.delegateId} />
            )}
            {payload.handoffId && (
              <KeyValue k="handoffId" v={payload.handoffId} />
            )}
            {payload.summary && <KeyValue k="summary" v={payload.summary} />}
          </div>
        </CardShell>
      )}

      {approvalArt && (
        <CardShell label="Approval / guardrail">
          <div className="px-3.5 py-3">
            <JsonTree data={approvalArt.preview as unknown} />
          </div>
        </CardShell>
      )}
    </div>
  );
}

// ─── Memory span panel (primitive === memory.*) ─────────────────────

function MemoryTab({ node }: { node: ObservabilityRunDetailNode }) {
  const snapshot = findArtifact(node, "memory.snapshot");
  // B5: authoritative recalled-blocks (read) + before/after state diff (write).
  const recall = findArtifact(node, "memory.recall")?.preview;
  const recallBlocks =
    recall &&
    typeof recall === "object" &&
    Array.isArray((recall as { blocks?: unknown }).blocks)
      ? (recall as { blocks: Array<Record<string, unknown>> }).blocks
      : null;
  const diff = findArtifact(node, "memory.diff")?.preview;
  const insp = inspectionOf(node);

  // Edge row (read/write descriptor) curated on inspection.relations when present.
  const relationItems = (insp?.relations ?? []) as readonly InspectionItem[];
  const memoryRel =
    ((relationItems.find(
      (r) => typeof r.kind === "string" && r.kind.startsWith("memory."),
    )?.data as Record<string, unknown> | undefined) ??
      {}) ||
    {};

  const op =
    (memoryRel.operation as string | undefined) ??
    (findAttribute(node, "operation") as string | undefined) ??
    node.primitive.split(".").pop() ??
    "—";
  const memoryId =
    (memoryRel.memoryId as string | undefined) ??
    node.memoryId ??
    (findAttribute(node, "memoryId") as string | undefined);
  const memoryType =
    (memoryRel.memoryType as string | undefined) ??
    (findAttribute(node, "memoryType", "kind") as string | undefined);
  const blockKind =
    (memoryRel.blockKind as string | undefined) ??
    (findAttribute(node, "blockKind") as string | undefined);
  const isBlackboard = memoryType === "blackboard";
  const query = findAttribute(node, "query") as string | undefined;
  const writeMode = findAttribute(node, "writeMode") as string | undefined;
  const proposalStatus = findAttribute(node, "proposalStatus") as
    | string
    | undefined;
  const resultsRaw = findAttribute(node, "results", "entries");
  // Prefer the B5 `memory.recall` blocks; else legacy result attributes.
  const results =
    recallBlocks ??
    (Array.isArray(resultsRaw)
      ? (resultsRaw as Array<Record<string, unknown>>)
      : []);
  const resultCountAttr = findAttribute(node, "resultCount");
  const recalled =
    results.length ||
    (typeof resultCountAttr === "number" ? resultCountAttr : 0);
  const topScore = results.reduce(
    (m, r) =>
      typeof r.score === "number" ? Math.max(m, r.score as number) : m,
    -1,
  );
  const isWrite =
    node.primitive.startsWith("memory.write") ||
    op === "write" ||
    writeMode != null;

  // Snapshot model. The backend emits one of: a `{ before, after }` diff, a
  // single `{ field, value }` state cell, or a generic state object. We render
  // all of them as readable "key: value" lines — never a raw JSON tree.
  const snap = snapshot?.preview;
  const snapObj =
    snap && typeof snap === "object" && !Array.isArray(snap)
      ? (snap as Record<string, unknown>)
      : undefined;
  const diffObj =
    diff && typeof diff === "object" && !Array.isArray(diff)
      ? (diff as Record<string, unknown>)
      : undefined;
  // Prefer the B5 `memory.diff` before/after; else a before/after-shaped snapshot.
  const beforeAfter =
    diffObj && ("before" in diffObj || "after" in diffObj)
      ? diffObj
      : snapObj && ("before" in snapObj || "after" in snapObj)
        ? snapObj
        : undefined;
  const stateEntries: Array<[string, unknown]> = beforeAfter
    ? []
    : snapObj
      ? "field" in snapObj
        ? [[String(snapObj.field), snapObj.value]]
        : Object.entries(snapObj)
      : [];
  const budgetDecision = memoryRenderBudgetDecision(snapObj, node);

  return (
    <div className="flex flex-col gap-5">
      {/* meta row (header shows name+status; this carries the memory-specific facts) */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={isBlackboard ? "crux" : "iris"} mono>
          {isBlackboard ? "shared state" : (memoryType ?? "memory")}
        </Chip>
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          {op}
        </span>
        {blockKind && !isBlackboard && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            · {blockKind}
          </span>
        )}
        {recalled > 0 && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            · recalled {recalled}
          </span>
        )}
        {topScore >= 0 && (
          <Chip tone={topScore >= 0.85 ? "ok" : "crux"} mono>
            top {topScore.toFixed(2)}
          </Chip>
        )}
        {writeMode && (
          <Chip tone={writeMode === "propose" ? "warn" : "crux"} mono>
            write · {writeMode}
          </Chip>
        )}
        {proposalStatus && (
          <Chip
            tone={
              proposalStatus === "pending"
                ? "warn"
                : proposalStatus === "approved"
                  ? "ok"
                  : "muted"
            }
            mono
          >
            proposal · {proposalStatus}
          </Chip>
        )}
        {budgetDecision && (
          <Chip tone={budgetDecision.dropped.length > 0 ? "warn" : "gold"} mono>
            budget ·{" "}
            {budgetDecision.usedTokens != null
              ? `${budgetDecision.usedTokens}/`
              : ""}
            {budgetDecision.maxTokens ?? "set"}
          </Chip>
        )}
        {memoryId && (
          <span
            className="ml-auto truncate font-mono text-[11px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            {memoryId}
          </span>
        )}
      </div>

      {query && (
        <SpanSection
          title="Query"
          right={
            memoryType ? (
              <Chip tone="muted" mono>
                {memoryType}
              </Chip>
            ) : undefined
          }
        >
          <div
            className="rounded-[8px] px-3.5 py-2.5 font-mono text-[12px]"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg)",
            }}
          >
            {query}
          </div>
        </SpanSection>
      )}

      {budgetDecision && (
        <SpanSection
          title="Render budget"
          right={
            budgetDecision.maxTokens != null ? (
              <Chip
                tone={budgetDecision.dropped.length > 0 ? "warn" : "gold"}
                mono
              >
                max {budgetDecision.maxTokens}
              </Chip>
            ) : undefined
          }
        >
          <div
            className="grid gap-2 rounded-[8px] px-3.5 py-3"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            }}
          >
            <BudgetBlockList
              label="Included"
              blocks={budgetDecision.included}
              tone="ok"
            />
            <BudgetBlockList
              label="Trimmed"
              blocks={budgetDecision.trimmed}
              tone="gold"
            />
            <BudgetBlockList
              label="Dropped"
              blocks={budgetDecision.dropped}
              tone="warn"
            />
          </div>
        </SpanSection>
      )}

      {results.length > 0 ? (
        <SpanSection
          title={`Recalled · ${results.length} block${results.length === 1 ? "" : "s"}`}
        >
          <div className="flex flex-col gap-1.5">
            {results.slice(0, 20).map((r, i) => (
              <MemoryRecalledRow
                key={i}
                r={r}
                fallbackBlock={blockKind ?? memoryType}
              />
            ))}
          </div>
        </SpanSection>
      ) : (
        recalled > 0 && (
          <SpanSection
            title={`Recalled · ${recalled} block${recalled === 1 ? "" : "s"}`}
          >
            <div
              className="text-[11.5px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              Block previews weren't captured for this run.
            </div>
          </SpanSection>
        )
      )}
      {/* B7: the backend no longer emits a `memory.recall` artifact for empty
          reads, so we no longer render a "Recalled · 0 blocks" placeholder. */}

      {beforeAfter ? (
        <SpanSection title="Snapshot · before → after">
          <div
            className="grid overflow-hidden rounded-[8px]"
            style={{
              gridTemplateColumns: "1fr 1fr",
              border: "1px solid var(--devtools-border)",
            }}
          >
            {(["before", "after"] as const).map((side, k) => (
              <div
                key={side}
                style={{
                  borderRight: k === 0 ? "1px solid var(--devtools-border)" : "none",
                }}
              >
                <div
                  className="px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em]"
                  style={{
                    color: "var(--devtools-fg-faint)",
                    background: "var(--devtools-bg-muted)",
                    borderBottom: "1px solid var(--devtools-border)",
                  }}
                >
                  {side}
                </div>
                <div className="px-3 py-2.5">
                  <SnapshotSide value={beforeAfter[side]} />
                </div>
              </div>
            ))}
          </div>
        </SpanSection>
      ) : (
        stateEntries.length > 0 && (
          <SpanSection title={isWrite ? "State · after write" : "State"}>
            <div
              className="flex flex-col gap-1.5 rounded-[8px] px-3.5 py-3"
              style={{
                background: "var(--devtools-bg-elev)",
                border: "1px solid var(--devtools-border)",
              }}
            >
              {stateEntries.map(([label, value], i) => (
                <div key={i} className="flex gap-2 font-mono text-[11.5px]">
                  <span
                    className="shrink-0"
                    style={{ color: "var(--devtools-fg-faint)" }}
                  >
                    {label}
                  </span>
                  <span
                    className="min-w-0 flex-1 break-words"
                    style={{ color: "var(--devtools-fg)" }}
                  >
                    {compactValue(value)}
                  </span>
                </div>
              ))}
            </div>
          </SpanSection>
        )
      )}
    </div>
  );
}

function BudgetBlockList({
  label,
  blocks,
  tone,
}: {
  label: string;
  blocks: readonly string[];
  tone: ChipTone;
}) {
  return (
    <div className="min-w-0">
      <div
        className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {label}
      </div>
      {blocks.length === 0 ? (
        <span
          className="font-mono text-[11px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          none
        </span>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {blocks.map((block) => (
            <Chip key={block} tone={tone} mono>
              {block}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

/** Compact, human-readable rendering of a value — `{ intent: refund, plan: annual }`
 *  style. Never an expandable raw-JSON tree (we don't surface internal blobs). */
function compactValue(v: unknown, depth = 0): string {
  if (v == null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => x == null || typeof x !== "object"))
      return `[${v
        .slice(0, 4)
        .map((x) => compactValue(x, depth + 1))
        .join(", ")}${v.length > 4 ? ", …" : ""}]`;
    return `[${v.length} items]`;
  }
  if (typeof v === "object") {
    if (depth >= 1) return "{…}";
    const ks = Object.keys(v as Record<string, unknown>);
    if (ks.length === 0) return "{}";
    return `{ ${ks
      .slice(0, 4)
      .map(
        (k) =>
          `${k}: ${compactValue((v as Record<string, unknown>)[k], depth + 1)}`,
      )
      .join(", ")}${ks.length > 4 ? ", …" : ""} }`;
  }
  return String(v);
}

/** design `CardMemory` recalled row — block-kind tag · key · preview · score chip. */
function MemoryRecalledRow({
  r,
  fallbackBlock,
}: {
  r: Record<string, unknown>;
  fallbackBlock?: string;
}) {
  const block = String(
    r.block ?? r.blockKind ?? r.kind ?? fallbackBlock ?? "block",
  );
  const key = String(r.key ?? r.id ?? r.sourceId ?? "—");
  const preview =
    (typeof r.preview === "string" && r.preview) ||
    (typeof r.content === "string" && r.content) ||
    (r.content != null ? compactValue(r.content) : "");
  const score = typeof r.score === "number" ? (r.score as number) : undefined;
  return (
    <div
      className="flex gap-2.5 rounded-[8px] px-3 py-2.5"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <span
        className="h-fit rounded-[3px] px-1.5 py-px font-mono text-[9px] uppercase"
        style={{ color: "var(--devtools-iris)", background: "var(--devtools-iris-soft)" }}
      >
        {block}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className="font-mono text-[11px]"
          style={{ color: "var(--devtools-crux)" }}
        >
          {key}
        </div>
        {preview && (
          <div
            className="mt-0.5 text-[11.5px] leading-[1.5]"
            style={{
              color: "var(--devtools-fg-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {preview}
          </div>
        )}
      </div>
      {score != null && (
        <Chip tone={score >= 0.85 ? "ok" : "crux"} mono>
          {score.toFixed(2)}
        </Chip>
      )}
    </div>
  );
}

/** One side of a before/after snapshot: string lines (`+` = added → green), or an
 *  object rendered as readable `key: value` lines (never a raw JSON tree). */
function SnapshotSide({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-col gap-1">
        {(value as unknown[]).map((line, i) => {
          const s = typeof line === "string" ? line : compactValue(line);
          return (
            <span
              key={i}
              className="font-mono text-[10.5px]"
              style={{
                color: s.startsWith("+")
                  ? "var(--devtools-ok)"
                  : "var(--devtools-fg-muted)",
              }}
            >
              {s}
            </span>
          );
        })}
      </div>
    );
  }
  if (value != null && typeof value === "object") {
    return (
      <div className="flex flex-col gap-1">
        {Object.entries(value as Record<string, unknown>).map(([k, v], i) => (
          <span
            key={i}
            className="font-mono text-[10.5px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            {k}: {compactValue(v, 1)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span
      className="font-mono text-[10.5px]"
      style={{
        color: value == null ? "var(--devtools-fg-faint)" : "var(--devtools-fg-muted)",
      }}
    >
      {value == null ? "—" : compactValue(value)}
    </span>
  );
}

// ─── Approval span panel (primitive === tool.approval) ─────────────

/** design `CardApproval` — human-in-the-loop decision banner + the gated call. */
function ApprovalCard({ node }: { node: ObservabilityRunDetailNode }) {
  const decision = (
    findAttribute(node, "decision", "outcome") as string | undefined
  )?.toLowerCase();
  const approvedAttr = findAttribute(node, "approved") as boolean | undefined;
  const approved = decision
    ? /approv|accept|grant|allow/.test(decision)
    : approvedAttr === true;
  const denied = decision
    ? /den|reject|block|refus/.test(decision)
    : approvedAttr === false;
  const approver = findAttribute(
    node,
    "approver",
    "approvedBy",
    "decidedBy",
    "reviewer",
  ) as string | undefined;
  const reason = findAttribute(node, "reason", "note", "comment") as
    | string
    | undefined;
  const gatedTool = findAttribute(node, "gatedTool", "tool", "toolName") as
    | string
    | undefined;
  const waitMs = findAttribute(node, "waitMs", "waitedMs", "waited") as
    | number
    | undefined;
  const insp = inspectionOf(node);
  const args =
    insp?.input?.[0]?.data ??
    findArtifact(node, "input")?.preview ??
    findArtifact(node, "tool.args")?.preview;

  const tone: ChipTone = approved ? "ok" : denied ? "danger" : "warn";
  const color = approved
    ? "var(--devtools-ok)"
    : denied
      ? "var(--devtools-danger)"
      : "var(--devtools-warn)";
  const bg = approved
    ? "var(--devtools-ok-soft)"
    : denied
      ? "var(--devtools-danger-soft)"
      : "var(--devtools-warn-soft)";
  const verb = approved ? "Approved" : denied ? "Denied" : "Pending";

  return (
    <div className="flex flex-col gap-5">
      <div
        className="flex items-center gap-2.5 rounded-[8px] px-3.5 py-3"
        style={{ background: bg }}
      >
        <div className="flex-1">
          <div className="text-[13px] font-semibold" style={{ color }}>
            {verb}
            {approver ? ` by ${approver}` : ""}
          </div>
          <div
            className="mt-0.5 text-[11.5px]"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            Human-in-the-loop decision on a gated tool call
            {waitMs != null ? ` · waited ${fmtDuration(waitMs)}` : ""}
            {reason ? ` · “${reason}”` : ""}
          </div>
        </div>
        <Chip tone={tone} dot>
          {decision ?? verb.toLowerCase()}
        </Chip>
      </div>

      <SpanSection title="Requested call">
        <div
          className="overflow-hidden rounded-[8px]"
          style={{ border: "1px solid var(--devtools-border)" }}
        >
          <div
            className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em]"
            style={{
              color: "var(--devtools-fg-faint)",
              background: "var(--devtools-bg-muted)",
              borderBottom: "1px solid var(--devtools-border)",
            }}
          >
            {gatedTool ?? "tool"} — requires approval
          </div>
          <div className="px-3 py-2.5">
            {args != null ? (
              <JsonTree data={args as unknown} />
            ) : (
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                (args not recorded)
              </span>
            )}
          </div>
        </div>
      </SpanSection>
    </div>
  );
}

// ─── Plan span panel (primitive === plan.*) ─────────────────────────

function planTaskStyle(s: string): {
  color: string;
  soft: string;
  label: string;
  done: boolean;
  strike: boolean;
} {
  const v = s.toLowerCase();
  if (/done|complete|success|finished/.test(v))
    return {
      color: "var(--devtools-ok)",
      soft: "var(--devtools-ok-soft)",
      label: "done",
      done: true,
      strike: false,
    };
  if (/doing|active|progress|running/.test(v))
    return {
      color: "var(--devtools-crux)",
      soft: "var(--devtools-crux-soft)",
      label: "doing",
      done: false,
      strike: false,
    };
  if (/abandon|cancel|skip|fail|drop/.test(v))
    return {
      color: "var(--devtools-fg-faint)",
      soft: "var(--devtools-bg-muted)",
      label: v,
      done: false,
      strike: true,
    };
  return {
    color: "var(--devtools-fg-muted)",
    soft: "var(--devtools-bg-muted)",
    label: "todo",
    done: false,
    strike: false,
  };
}

/** design `CardPlan` — goal + task list (done/doing/todo/abandoned). */
function PlanCard({ node }: { node: ObservabilityRunDetailNode }) {
  const goal = findAttribute(
    node,
    "goal",
    "objective",
    "description",
    "summary",
  ) as string | undefined;
  const tasksRaw = findAttribute(node, "tasks", "steps", "items", "todos");
  const tasks: { label: string; status: string }[] = Array.isArray(tasksRaw)
    ? (tasksRaw as unknown[]).map((t, i) => {
        if (typeof t === "string") return { label: t, status: "todo" };
        const o = (t ?? {}) as Record<string, unknown>;
        return {
          label: String(
            o.id ?? o.title ?? o.name ?? o.label ?? o.task ?? `task ${i + 1}`,
          ),
          status: String(o.status ?? o.state ?? "todo"),
        };
      })
    : [];
  const done = tasks.filter((t) => planTaskStyle(t.status).done).length;

  if (!goal && tasks.length === 0) {
    return <EmptyHint>No plan captured for this span.</EmptyHint>;
  }

  return (
    <div className="flex flex-col gap-5">
      {goal && (
        <SpanSection
          title="Goal"
          right={
            tasks.length > 0 ? (
              <Chip tone="crux" dot>
                {done} of {tasks.length} done
              </Chip>
            ) : undefined
          }
        >
          <div
            className="rounded-[8px] px-3.5 py-2.5 text-[13px]"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              fontFamily: "var(--devtools-serif)",
            }}
          >
            {goal}
          </div>
        </SpanSection>
      )}
      {tasks.length > 0 && (
        <SpanSection title="Tasks">
          <div className="flex flex-col gap-1.5">
            {tasks.map((tk, i) => {
              const st = planTaskStyle(tk.status);
              return (
                <div
                  key={i}
                  className="flex items-center gap-2.5 rounded-[8px] px-3 py-2"
                  style={{
                    background: "var(--devtools-bg-elev)",
                    border: "1px solid var(--devtools-border)",
                    opacity: st.strike ? 0.55 : 1,
                  }}
                >
                  <span
                    className="size-3 shrink-0 rounded-[4px]"
                    style={{
                      background: st.soft,
                      boxShadow: `inset 0 0 0 1px ${st.color}`,
                    }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[12px]"
                    style={{
                      textDecoration: st.strike ? "line-through" : "none",
                    }}
                  >
                    {tk.label}
                  </span>
                  <span
                    className="font-mono text-[9.5px] uppercase"
                    style={{ color: st.color }}
                  >
                    {st.label}
                  </span>
                </div>
              );
            })}
          </div>
        </SpanSection>
      )}
    </div>
  );
}

// ─── Handoff / delegate span panel ──────────────────────────────────

/** Small agent pill (design `AgentPill`). */
function AgentPill({ name, dim }: { name: string; dim?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 font-mono text-[12px] font-semibold"
      style={
        dim
          ? {
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg-muted)",
            }
          : { background: "var(--devtools-iris-soft)", color: "var(--devtools-iris)" }
      }
    >
      {name}
    </span>
  );
}

/** in→out payload grid (design's input/transform/summary frame). */
function PayloadGrid({
  cells,
}: {
  cells: { label: string; size?: string; body: unknown }[];
}) {
  return (
    <div
      className="grid overflow-hidden rounded-[8px]"
      style={{
        gridTemplateColumns: `repeat(${cells.length}, 1fr)`,
        border: "1px solid var(--devtools-border)",
      }}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          style={{
            borderRight:
              i < cells.length - 1 ? "1px solid var(--devtools-border)" : "none",
          }}
        >
          <div
            className="flex items-center justify-between px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em]"
            style={{
              color: "var(--devtools-fg-faint)",
              background: "var(--devtools-bg-muted)",
              borderBottom: "1px solid var(--devtools-border)",
            }}
          >
            <span>{c.label}</span>
            {c.size && <span>{c.size}</span>}
          </div>
          <div className="px-3 py-2.5">
            {c.body != null ? (
              typeof c.body === "string" ? (
                <div
                  className="text-[11.5px] leading-[1.5]"
                  style={{ color: "var(--devtools-fg-muted)" }}
                >
                  {c.body}
                </div>
              ) : (
                <JsonTree data={c.body as unknown} />
              )
            ) : (
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                (none)
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function fmtBytes(n: number | undefined): string | undefined {
  if (n == null) return undefined;
  return n >= 1024 ? `${(n / 1024).toFixed(1)} kB` : `${n} B`;
}

function HandoffTab({
  node,
  onSelect,
}: {
  node: ObservabilityRunDetailNode;
  onSelect?: (id: string) => void;
}) {
  const isDelegate = node.primitive.startsWith("delegate.");
  const fromAgent =
    (findAttribute(node, "fromAgent", "from", "caller") as
      | string
      | undefined) ?? "—";
  const toAgent =
    (findAttribute(node, "toAgent", "to", "agent", "callee") as
      | string
      | undefined) ?? "—";
  const summary = findAttribute(node, "summary") as string | undefined;
  const reason = findAttribute(node, "reason") as string | undefined;
  const hop = findAttribute(node, "hop", "hopIndex") as number | undefined;
  const maxHops = findAttribute(node, "maxHops", "hopCount", "totalHops") as
    | number
    | undefined;
  const pathRaw = findAttribute(node, "handoffPath", "path");
  const handoffPath = Array.isArray(pathRaw)
    ? (pathRaw as string[]).filter((s) => typeof s === "string")
    : [];
  const inputSize = findAttribute(node, "inputSize") as number | undefined;
  const outputSize = findAttribute(node, "outputSize") as number | undefined;

  // Curated input/output (backend emits proper Input + Output here).
  const insp = inspectionOf(node);
  const inputData =
    insp?.input?.[0]?.data ?? findArtifact(node, "input")?.preview;
  const outputItem = insp?.output?.[0];
  const outputData =
    outputItem?.data ??
    findArtifact(node, "output")?.preview ??
    findArtifact(node, "handoff.payload")?.preview;
  const output =
    outputData &&
    typeof outputData === "object" &&
    "data" in (outputData as Record<string, unknown>)
      ? (outputData as { data: unknown }).data
      : outputData;

  // Delegate: the sub-run is a descendant agent.run we can drill into.
  const subRun = isDelegate
    ? gatherDescendants(node).find(
        (d) => d.primitive === "agent.run" && d.id !== node.id,
      )
    : undefined;

  if (isDelegate) {
    return (
      <div className="flex flex-col gap-5">
        {/* call-and-return banner */}
        <div
          className="flex items-center gap-2.5 rounded-[8px] px-3.5 py-3"
          style={{ background: "var(--devtools-iris-soft)" }}
        >
          <Icon name="layers" size={15} color="var(--devtools-iris)" />
          <div className="flex-1">
            <div className="text-[13px] font-semibold">
              <span className="font-mono">{fromAgent}</span> called{" "}
              <span className="font-mono" style={{ color: "var(--devtools-iris)" }}>
                {toAgent}
              </span>{" "}
              as a tool
            </div>
            <div
              className="mt-0.5 text-[11.5px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              Call-and-return — the parent keeps control and gets a value back.
              {subRun
                ? ` Ran its own ${gatherDescendants(subRun).length}-span sub-trace.`
                : ""}
            </div>
          </div>
          {subRun && onSelect && (
            <button
              type="button"
              onClick={() => onSelect(subRun.id)}
              className="shrink-0 rounded-[8px] px-2.5 py-1.5 font-mono text-[11px]"
              style={{
                background: "var(--devtools-bg-elev)",
                border: "1px solid var(--devtools-border)",
                color: "var(--devtools-crux)",
              }}
            >
              Open sub-run →
            </button>
          )}
        </div>

        {/* tool / delegate / handoff distinction */}
        <div className="flex gap-2">
          {(
            [
              ["tool", "calls code → value", false],
              ["delegate", "calls an agent → value (this)", true],
              ["handoff", "transfers control to an agent", false],
            ] as const
          ).map(([k, d, on]) => (
            <div
              key={k}
              className="flex-1 rounded-[8px] px-2.5 py-2"
              style={{
                background: on ? "var(--devtools-crux-soft)" : "var(--devtools-bg-elev)",
                border: `1px solid ${on ? "var(--devtools-crux-line)" : "var(--devtools-border)"}`,
              }}
            >
              <div
                className="font-mono text-[10.5px] font-semibold"
                style={{ color: on ? "var(--devtools-crux)" : "var(--devtools-fg)" }}
              >
                {k}
              </div>
              <div
                className="mt-0.5 text-[10px]"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                {d}
              </div>
            </div>
          ))}
        </div>

        <SpanSection
          title="Args → result"
          right={
            fmtBytes(outputSize) ? (
              <Chip tone="ok" mono>
                {fmtBytes(inputSize) ?? "—"} → {fmtBytes(outputSize)}
              </Chip>
            ) : undefined
          }
        >
          <PayloadGrid
            cells={[
              {
                label: "args (in)",
                size: fmtBytes(inputSize),
                body: inputData,
              },
              {
                label: "result (out)",
                size: fmtBytes(outputSize),
                body: output,
              },
            ]}
          />
        </SpanSection>
      </div>
    );
  }

  // handoff.prepare
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <AgentPill name={fromAgent} dim />
        <svg width="40" height="12">
          <line
            x1="0"
            y1="6"
            x2="32"
            y2="6"
            stroke="var(--devtools-iris)"
            strokeWidth="1.6"
            strokeDasharray="4 3"
          />
          <path
            d="M32 2l6 4-6 4"
            fill="none"
            stroke="var(--devtools-iris)"
            strokeWidth="1.6"
          />
        </svg>
        <AgentPill name={toAgent} />
        {hop != null && (
          <span
            className="font-mono text-[10.5px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            hop {hop}
            {maxHops != null ? ` of ${maxHops}` : ""} · control moves on
          </span>
        )}
        <div className="flex-1" />
        {summary && (
          <Chip tone="muted" mono>
            summarized
          </Chip>
        )}
      </div>

      {handoffPath.length > 0 && (
        <div
          className="font-mono text-[11px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          path · {handoffPath.join(" → ")}
        </div>
      )}

      <SpanSection
        title="Input → transform → summary"
        right={
          fmtBytes(outputSize) ? (
            <Chip tone="ok" mono>
              {fmtBytes(inputSize) ?? "—"} → {fmtBytes(outputSize)}
            </Chip>
          ) : undefined
        }
      >
        <PayloadGrid
          cells={[
            { label: "input", size: fmtBytes(inputSize), body: inputData },
            {
              label: "summary",
              size: fmtBytes(outputSize),
              body: summary ?? output,
            },
          ]}
        />
      </SpanSection>

      {reason && (
        <div
          className="font-mono text-[10.5px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          reason · {reason}
        </div>
      )}
    </div>
  );
}

// ─── Embedding span panel (primitive === embedding.call) ────────────

/** design `CardEmbedding` center: a Cache hit/fresh bar + a Run stats grid
 *  (model · dimensions · truncations · rate-limit wait). */
function EmbeddingCard({ node }: { node: ObservabilityRunDetailNode }) {
  const model = findAttribute(node, "model", "modelId") as string | undefined;
  const dims = findAttribute(node, "dimensions", "dims", "dimension") as
    | number
    | undefined;
  const total = findAttribute(node, "inputs", "inputCount", "count") as
    | number
    | undefined;
  const hit = findAttribute(node, "cacheHits", "cachedInputs", "cached") as
    | number
    | undefined;
  const truncations = findAttribute(node, "truncations", "truncated") as
    | number
    | undefined;
  const retries = findAttribute(node, "retries", "retryCount") as
    | number
    | undefined;
  const rateLimitWait = findAttribute(
    node,
    "rateLimitWaitMs",
    "rateLimitWait",
  ) as number | undefined;
  const pct =
    hit != null && total ? Math.round((hit / total) * 100) : undefined;

  const cells: [string, string][] = [];
  if (model) cells.push(["model", shortModelId(model) ?? model]);
  if (dims != null) cells.push(["dimensions", dims.toLocaleString()]);
  if (truncations != null) cells.push(["truncations", String(truncations)]);
  if (rateLimitWait != null)
    cells.push(["rate-limit wait", fmtDuration(rateLimitWait)]);
  if (retries != null) cells.push(["retries", String(retries)]);

  if (cells.length === 0 && hit == null) {
    return <EmptyHint>No embedding metrics captured for this span.</EmptyHint>;
  }

  return (
    <div className="flex flex-col gap-5">
      {hit != null && total != null && total > 0 && (
        <SpanSection
          title={`Cache · ${hit} / ${total} hit`}
          right={
            pct != null ? (
              <Chip tone="ok" mono>
                {pct}% cached
              </Chip>
            ) : undefined
          }
        >
          <div
            className="flex h-6 overflow-hidden rounded-[6px]"
            style={{ boxShadow: "inset 0 0 0 1px var(--devtools-border)" }}
          >
            <div
              className="flex items-center justify-center font-mono text-[9.5px] font-semibold"
              style={{
                width: `${(hit / total) * 100}%`,
                background: "var(--devtools-ok)",
                opacity: 0.85,
                color: "var(--devtools-bg)",
              }}
            >
              cache {hit}
            </div>
            <div
              className="flex flex-1 items-center justify-center font-mono text-[9.5px] font-semibold"
              style={{
                background: "var(--devtools-crux)",
                opacity: 0.7,
                color: "var(--devtools-bg)",
              }}
            >
              fresh {total - hit}
            </div>
          </div>
        </SpanSection>
      )}
      {cells.length > 0 && (
        <SpanSection title="Run">
          <div
            className="grid gap-2.5"
            style={{
              gridTemplateColumns: `repeat(${Math.min(cells.length, 4)}, minmax(0, 1fr))`,
            }}
          >
            {cells.map(([k, v]) => (
              <div
                key={k}
                className="rounded-[8px] px-3 py-2.5"
                style={{
                  background: "var(--devtools-bg-elev)",
                  border: "1px solid var(--devtools-border)",
                }}
              >
                <div
                  className="font-mono text-[10px] uppercase tracking-[0.04em]"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  {k}
                </div>
                <div className="mt-0.5 font-mono text-[13px] font-semibold">
                  {v}
                </div>
              </div>
            ))}
          </div>
        </SpanSection>
      )}
    </div>
  );
}

// ─── Retrieval span panel + Retrieval tab (for parent runs) ─────────

/** design `CardRetrieval` center: Query (mode·fusion) · Stages funnel · ranked Hits.
 *  Identity (retriever · returned · cost) + the pipeline/index inspector live in
 *  `SelectedSpanHeader` / `SpanInspector`. */
function RetrievalSpanTab({ node }: { node: ObservabilityRunDetailNode }) {
  const { query, mode, fusion, hits, stages } = retrievalEntries(node);
  const modeChip = [mode, fusion].filter(Boolean).join(" · ");
  // funnel summary: in→out across stages (e.g. "12 → 8 → 3")
  const funnel = stages
    .map((s) =>
      typeof s.outHits === "number" ? (s.outHits as number) : undefined,
    )
    .filter((n): n is number => n != null);

  return (
    <div className="flex flex-col gap-5">
      {query && (
        <SpanSection
          title="Query"
          right={
            modeChip ? (
              <Chip tone="muted" mono>
                {modeChip}
              </Chip>
            ) : undefined
          }
        >
          <div
            className="rounded-[8px] px-3.5 py-2.5 font-mono text-[12px]"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg)",
            }}
          >
            {query}
          </div>
        </SpanSection>
      )}

      {stages.length > 0 && (
        <SpanSection
          title="Stages"
          right={
            funnel.length > 0 ? (
              <span
                className="font-mono text-[11px]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {funnel.join(" → ")}
              </span>
            ) : undefined
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {stages.map((s, i) => {
              const name = String(s.name ?? s.kind ?? `stage ${i + 1}`);
              const out =
                typeof s.outHits === "number"
                  ? (s.outHits as number)
                  : undefined;
              const inH =
                typeof s.inHits === "number" ? (s.inHits as number) : undefined;
              const status = s.status != null ? String(s.status) : undefined;
              return (
                <div
                  key={i}
                  className="min-w-[84px] flex-1 rounded-[8px] px-2.5 py-2"
                  style={{
                    background: "var(--devtools-bg-elev)",
                    border: "1px solid var(--devtools-border)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="truncate font-mono text-[10px]"
                      style={{ color: "var(--devtools-fg-muted)" }}
                    >
                      {name}
                    </span>
                    {status && status !== "success" && (
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: "var(--devtools-warn)" }}
                      />
                    )}
                  </div>
                  <div
                    className="font-mono text-[13px] font-semibold"
                    style={{ color: "var(--devtools-ok)" }}
                  >
                    {out ?? "·"}
                    {inH != null && out != null && inH !== out && (
                      <span
                        className="ml-1 text-[10px] font-normal"
                        style={{ color: "var(--devtools-fg-faint)" }}
                      >
                        ← {inH}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </SpanSection>
      )}

      <SpanSection
        title={`Hits · ${hits.length} chunk${hits.length === 1 ? "" : "s"}`}
        right={
          hits.length > 0 ? (
            <Chip tone="ok" dot>
              ranked
            </Chip>
          ) : undefined
        }
      >
        {hits.length === 0 ? (
          <EmptyHint>No hits returned for this query.</EmptyHint>
        ) : (
          <div className="flex flex-col gap-1.5">
            {hits.slice(0, 20).map((h, i) => (
              <ChunkHitRow
                key={i}
                hit={h}
                rank={typeof h.rank === "number" ? (h.rank as number) : i + 1}
              />
            ))}
          </div>
        )}
      </SpanSection>
    </div>
  );
}

/** design `ChunkHit` atom — #rank · sourceId · chunkId · 2-line preview · score chip. */
function ChunkHitRow({
  hit,
  rank,
}: {
  hit: Record<string, unknown>;
  rank: number;
}) {
  const { navigate } = useNavigation();
  const source =
    hit.source && typeof hit.source === "object" && !Array.isArray(hit.source)
      ? (hit.source as Record<string, unknown>)
      : undefined;
  const sourceId = typeof source?.id === "string" ? source.id : undefined;
  const chunkId =
    typeof hit.chunkId === "string"
      ? hit.chunkId
      : typeof hit.id === "string"
        ? (hit.id as string)
        : undefined;
  const score =
    typeof hit.score === "number" ? (hit.score as number) : undefined;
  const preview =
    (typeof hit.preview === "string" && hit.preview) ||
    (typeof hit.contentPreview === "string" && hit.contentPreview) ||
    (typeof hit.text === "string" && hit.text) ||
    (typeof hit.content === "string" && hit.content) ||
    "";
  const used = hit.used !== false && hit.grounded !== false;
  const scoreTone: ChipTone =
    score == null
      ? "muted"
      : score >= 0.9
        ? "ok"
        : score >= 0.82
          ? "crux"
          : "warn";
  return (
    <div
      className="flex gap-2.5 rounded-[8px] px-3 py-2.5"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
        opacity: used ? 1 : 0.66,
      }}
    >
      <span
        className="w-4 shrink-0 font-mono text-[11px]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        #{rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          {sourceId && (
            <button
              type="button"
              onClick={() =>
                navigate({ view: "library-index", contextId: sourceId })
              }
              className="font-mono text-[11px] hover:underline"
              style={{ color: "var(--devtools-crux)" }}
            >
              {sourceId}
            </button>
          )}
          {chunkId && (
            <span
              className="truncate font-mono text-[10.5px]"
              style={{ color: "var(--devtools-fg-faint)" }}
            >
              {chunkId}
            </span>
          )}
        </div>
        {preview && (
          <div
            className="text-[11.5px] leading-[1.5]"
            style={{
              color: "var(--devtools-fg-muted)",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {preview}
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {score != null && (
          <Chip tone={scoreTone} mono>
            {score.toFixed(2)}
          </Chip>
        )}
        {!used && (
          <span
            className="font-mono text-[9.5px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            unused
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Tools tab (for parent runs — aggregates child tool.calls) ──────

function ToolsTab({ scope }: { scope: ObservabilityRunDetailNode }) {
  const calls = useMemo(
    () =>
      gatherDescendants(scope).filter(
        (n) =>
          n.primitive === "tool.call" || n.primitive === "tool" || n.toolName,
      ),
    [scope],
  );

  const requests = useMemo(() => collectToolRequests(scope), [scope]);

  if (calls.length === 0 && requests.length === 0) {
    return <EmptyHint>No tool calls or requests under this span.</EmptyHint>;
  }
  return (
    <div className="flex flex-col gap-4">
      {requests.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool requests · {requests.length}</Eyebrow>
          {requests.map((r, i) => (
            <CardShell
              key={`${r.toolCallId ?? i}`}
              label={
                <span className="flex items-center gap-2">
                  <Icon name="sparkle" size={11} color="var(--devtools-warn)" />
                  <span className="font-mono" style={{ textTransform: "none" }}>
                    {r.toolName ?? "tool"}
                  </span>
                  {r.toolCallId && (
                    <span
                      className="font-mono"
                      style={{
                        textTransform: "none",
                        color: "var(--devtools-fg-faint)",
                      }}
                    >
                      · {r.toolCallId.slice(0, 12)}
                    </span>
                  )}
                </span>
              }
              right={
                <span
                  className="font-mono"
                  style={{ color: "var(--devtools-fg-faint)" }}
                >
                  requested by{" "}
                  {r.owner.display?.label ?? r.owner.name ?? r.owner.primitive}
                </span>
              }
            >
              {r.args !== undefined && (
                <div className="px-3.5 py-3">
                  <JsonTree data={r.args as unknown} />
                </div>
              )}
            </CardShell>
          ))}
        </div>
      )}
      {calls.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Tool calls · {calls.length}</Eyebrow>
          {calls.map((c) => {
            const name = c.toolName ?? c.name ?? "tool";
            const args =
              findArtifact(c, "tool.args")?.preview ??
              findAttribute(c, "args", "input");
            const result =
              findArtifact(c, "tool.result")?.preview ??
              findAttribute(c, "result", "output");
            return (
              <CardShell
                key={c.id}
                label={
                  <span className="flex items-center gap-2">
                    <Chip tone={statusTone(c.status)} dot>
                      {statusLabel(c.status)}
                    </Chip>
                    <span
                      className="font-mono"
                      style={{ textTransform: "none" }}
                    >
                      {name}
                    </span>
                  </span>
                }
                right={fmtDuration(nodeDuration(c))}
              >
                <div
                  className="grid gap-px"
                  style={{ background: "var(--devtools-border)" }}
                >
                  <div
                    className="px-3.5 py-2"
                    style={{ background: "var(--devtools-bg-elev)" }}
                  >
                    <Eyebrow>Args</Eyebrow>
                    <div className="mt-1.5">
                      {args !== undefined ? (
                        <JsonTree data={args as unknown} />
                      ) : (
                        <span
                          className="text-[12px]"
                          style={{ color: "var(--devtools-fg-faint)" }}
                        >
                          (no args)
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="px-3.5 py-2"
                    style={{ background: "var(--devtools-bg-elev)" }}
                  >
                    <Eyebrow>Result</Eyebrow>
                    <div className="mt-1.5">
                      {result !== undefined ? (
                        <JsonTree data={result as unknown} />
                      ) : (
                        <span
                          className="text-[12px]"
                          style={{ color: "var(--devtools-fg-faint)" }}
                        >
                          (no result)
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </CardShell>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Retrieval tab (for parent runs — aggregates child retrieval/memory) ─

function RetrievalAggregateTab({
  scope,
}: {
  scope: ObservabilityRunDetailNode;
}) {
  const all = useMemo(
    () =>
      gatherDescendants(scope).filter(
        (n) =>
          n.primitive.startsWith("retrieval.") ||
          n.primitive === "embedding.call" ||
          n.primitive.startsWith("memory."),
      ),
    [scope],
  );
  if (all.length === 0) {
    return (
      <EmptyHint>No retrieval / memory activity under this span.</EmptyHint>
    );
  }
  const retrievals = all.filter((n) => !n.primitive.startsWith("memory."));
  const memory = all.filter((n) => n.primitive.startsWith("memory."));
  return (
    <div className="flex flex-col gap-4">
      {retrievals.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Retrieval · {retrievals.length}</Eyebrow>
          {retrievals.map((r) => {
            const { query, hits } = retrievalEntries(r);
            return (
              <CardShell
                key={r.id}
                label={r.retrieverId ?? r.name ?? r.primitive}
                right={`${hits.length} hits · ${fmtDuration(nodeDuration(r))}`}
              >
                <div className="flex flex-col gap-1.5 px-3.5 py-3">
                  {query && (
                    <div className="mb-1 font-mono text-[12px]">{query}</div>
                  )}
                  {hits.length === 0 ? (
                    <span
                      className="text-[12px]"
                      style={{ color: "var(--devtools-fg-faint)" }}
                    >
                      (no hits)
                    </span>
                  ) : (
                    hits
                      .slice(0, 12)
                      .map((h, i) => (
                        <ChunkHitRow
                          key={i}
                          hit={h}
                          rank={
                            typeof h.rank === "number"
                              ? (h.rank as number)
                              : i + 1
                          }
                        />
                      ))
                  )}
                </div>
              </CardShell>
            );
          })}
        </div>
      )}
      {memory.length > 0 && (
        <div className="flex flex-col gap-2">
          <Eyebrow>Memory · {memory.length}</Eyebrow>
          {memory.map((m) => {
            const recall = findArtifact(m, "memory.recall")?.preview;
            const diff = findArtifact(m, "memory.diff")?.preview;
            const snapshot = findArtifact(m, "memory.snapshot")?.preview;
            const preview = recall ?? diff ?? snapshot;
            const previewKind = recall
              ? "recall"
              : diff
                ? "diff"
                : snapshot
                  ? "snapshot"
                  : undefined;
            return (
              <CardShell
                key={m.id}
                label={
                  <span className="flex items-center gap-2">
                    <span style={{ textTransform: "none" }}>
                      {m.primitive.replace("memory.", "")}
                    </span>
                    {(findAttribute(m, "memoryType", "kind") as
                      | string
                      | undefined) && (
                      <Chip tone="iris">
                        {String(findAttribute(m, "memoryType", "kind"))}
                      </Chip>
                    )}
                    {previewKind && <Chip tone="muted">{previewKind}</Chip>}
                  </span>
                }
                right={m.memoryId}
              >
                {preview != null ? (
                  <div className="px-3.5 py-3">
                    <JsonTree data={preview as unknown} />
                  </div>
                ) : (
                  <div className="px-3.5 py-3">
                    <EmptyHint>No memory artifact attached.</EmptyHint>
                  </div>
                )}
              </CardShell>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Scores ─────────────────────────────────────────────────────────

function ScoresTab({
  node,
  judges,
}: {
  node: ObservabilityRunDetailNode;
  judges: readonly JudgeEventData[];
}) {
  type Entry = { name: string; score: number; reasoning?: string };
  // Prefer inspection.scores when ribbed by backend
  const fromInspection = useMemo<Entry[]>(() => {
    const insp = inspectionOf(node);
    if (!insp?.scores) return [];
    const items = insp.scores;
    const out: Entry[] = [];
    for (const item of items) {
      const data = item.data;
      if (data == null) continue;
      if (Array.isArray(data)) {
        for (const e of data as Array<{
          name?: string;
          metricId?: string;
          score?: number;
          reasoning?: string;
        }>) {
          if (typeof e.score === "number") {
            out.push({
              name: e.name ?? e.metricId ?? item.label ?? "score",
              score: e.score,
              reasoning: e.reasoning,
            });
          }
        }
        continue;
      }
      if (typeof data === "object") {
        const obj = data as {
          name?: string;
          metricId?: string;
          score?: number;
          reasoning?: string;
          scores?: unknown;
        };
        if (Array.isArray(obj.scores)) {
          for (const e of obj.scores as Array<{
            name?: string;
            metricId?: string;
            score?: number;
            reasoning?: string;
          }>) {
            if (typeof e.score === "number") {
              out.push({
                name: e.name ?? e.metricId ?? "score",
                score: e.score,
                reasoning: e.reasoning,
              });
            }
          }
        } else if (typeof obj.score === "number") {
          out.push({
            name: obj.name ?? obj.metricId ?? item.label ?? "score",
            score: obj.score,
            reasoning: obj.reasoning,
          });
        }
      }
    }
    return out;
  }, [node]);

  const fromArtifact = useMemo<Entry[]>(() => {
    if (fromInspection.length > 0) return [];
    const art = findArtifact(node, "score.report");
    const raw = art?.preview;
    if (!raw) return [];
    if (Array.isArray(raw)) {
      return (
        raw as Array<{
          name?: string;
          metricId?: string;
          score?: number;
          reasoning?: string;
        }>
      )
        .filter((e) => typeof e.score === "number")
        .map((e) => ({
          name: e.name ?? e.metricId ?? "score",
          score: e.score!,
          reasoning: e.reasoning,
        }));
    }
    if (typeof raw === "object" && raw !== null) {
      const list = (raw as { scores?: unknown }).scores;
      if (Array.isArray(list)) {
        return (
          list as Array<{
            name?: string;
            metricId?: string;
            score?: number;
            reasoning?: string;
          }>
        )
          .filter((e) => typeof e.score === "number")
          .map((e) => ({
            name: e.name ?? e.metricId ?? "score",
            score: e.score!,
            reasoning: e.reasoning,
          }));
      }
    }
    return [];
  }, [node]);
  const fromJudges = useMemo<Entry[]>(
    () =>
      judges.map((j) => ({
        name: j.metricId,
        score: j.score,
        reasoning: j.reasoning,
      })),
    [judges],
  );
  const entries =
    fromInspection.length > 0
      ? fromInspection
      : fromArtifact.length > 0
        ? fromArtifact
        : fromJudges;

  if (entries.length === 0) {
    return (
      <EmptyHint>No scorer / judge results recorded for this span.</EmptyHint>
    );
  }
  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}
    >
      {entries.map((e, i) => {
        const tone: ChipTone =
          e.score >= 0.85
            ? "ok"
            : e.score >= 0.6
              ? "crux"
              : e.score < 0.4
                ? "danger"
                : "warn";
        const palette = {
          ok: { fg: "var(--devtools-ok)", bg: "var(--devtools-ok-soft)" },
          crux: { fg: "var(--devtools-crux)", bg: "var(--devtools-crux-soft)" },
          warn: { fg: "var(--devtools-warn)", bg: "var(--devtools-warn-soft)" },
          danger: { fg: "var(--devtools-danger)", bg: "var(--devtools-danger-soft)" },
          muted: { fg: "var(--devtools-fg-muted)", bg: "var(--devtools-bg-muted)" },
          iris: { fg: "var(--devtools-iris)", bg: "var(--devtools-iris-soft)" },
        }[tone];
        return (
          <div
            key={`${e.name}-${i}`}
            className="rounded-[10px] px-4 py-3"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
            }}
          >
            <div className="mb-2 flex items-center justify-between">
              <span
                className="font-mono text-[12px]"
                style={{ color: "var(--devtools-fg-muted)" }}
              >
                {e.name}
              </span>
              <span
                className="rounded-[4px] px-2 py-0.5 font-mono text-[12px] font-semibold"
                style={{ background: palette.bg, color: palette.fg }}
              >
                {e.score.toFixed(2)}
              </span>
            </div>
            {e.reasoning && (
              <div
                className="text-[12px] leading-[1.55]"
                style={{ color: "var(--devtools-fg-faint)" }}
              >
                {e.reasoning}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Citations ──────────────────────────────────────────────────────

function CitationsTab({ node }: { node: ObservabilityRunDetailNode }) {
  type Entry = {
    num?: string | number;
    sourceId?: string;
    path?: string;
    score?: number;
    status?: string;
  };

  // Prefer inspection.citations
  const fromInspection: Entry[] = useMemo(() => {
    const insp = inspectionOf(node);
    if (!insp?.citations) return [];
    const out: Entry[] = [];
    for (const item of insp.citations) {
      const data = item.data;
      if (data == null) continue;
      if (Array.isArray(data)) {
        out.push(...(data as Entry[]));
        continue;
      }
      if (typeof data === "object") {
        const obj = data as { citations?: unknown; entries?: unknown };
        const list = obj.citations ?? obj.entries;
        if (Array.isArray(list)) out.push(...(list as Entry[]));
        else out.push(data as Entry);
      }
    }
    return out;
  }, [node]);

  const report = findArtifact(node, "citation.report");
  const fromArtifact: Entry[] = useMemo(() => {
    if (fromInspection.length > 0) return [];
    const raw = report?.preview;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as Entry[];
    if (typeof raw === "object" && raw !== null) {
      const list =
        (raw as { citations?: unknown; entries?: unknown }).citations ??
        (raw as { entries?: unknown }).entries;
      if (Array.isArray(list)) return list as Entry[];
    }
    return [];
  }, [report, fromInspection]);

  const entries = fromInspection.length > 0 ? fromInspection : fromArtifact;
  if (entries.length === 0) {
    return <PendingFromBackend what="Citation report" />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((c, i) => {
        const num = c.num ?? `[${i + 1}]`;
        const path = c.path ?? c.sourceId ?? "";
        const tone: ChipTone =
          c.status === "unused" || c.status === "warn" ? "warn" : "ok";
        return (
          <div
            key={`${num}-${path}-${i}`}
            className="flex items-center gap-2.5 rounded-[6px] px-3 py-2"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
            }}
          >
            <span
              className="font-mono text-[11.5px]"
              style={{ color: "var(--devtools-crux)" }}
            >
              {num}
            </span>
            <span
              className="flex-1 truncate font-mono text-[11.5px]"
              style={{ color: "var(--devtools-fg)" }}
              title={path}
            >
              {path}
            </span>
            {typeof c.score === "number" ? (
              <Chip tone={tone} mono>
                {c.score.toFixed(2)}
              </Chip>
            ) : (
              <Chip tone={tone}>{c.status ?? "unused"}</Chip>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Children list (group/flow/composition) ─────────────────────────

function ChildrenTab({
  node,
  onSelect,
}: {
  node: ObservabilityRunDetailNode;
  onSelect: (id: string) => void;
}) {
  const children = node.children ?? [];
  if (children.length === 0) {
    return <EmptyHint>No child spans under this node.</EmptyHint>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>
        {node.primitive.startsWith("flow") ? "Steps" : "Children"} ·{" "}
        {children.length}
      </Eyebrow>
      {children.map((c: ObservabilityRunDetailNode) => {
        const accent = primitiveAccentVar(c.primitive);
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="grid items-center gap-2.5 rounded-[8px] px-3 py-2 text-left transition-opacity hover:opacity-90"
            style={{
              gridTemplateColumns: "88px 1fr 90px 70px 70px",
              background: "var(--devtools-bg-elev)",
              border: "1px solid var(--devtools-border)",
              borderLeft: `3px solid ${accent}`,
            }}
          >
            <Chip tone={statusTone(c.status)} dot>
              {statusLabel(c.status)}
            </Chip>
            <span className="flex min-w-0 items-center gap-2 truncate font-mono text-[12px]">
              <span style={{ color: accent }}>{c.primitive}</span>
              <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
              <span className="truncate" style={{ color: "var(--devtools-fg)" }}>
                {c.display?.label ?? c.name}
              </span>
            </span>
            <span
              className="text-right font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {fmtDuration(nodeDuration(c))}
            </span>
            <span
              className="text-right font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {fmtTokens(nodeTokens(c))}
            </span>
            <span
              className="text-right font-mono text-[11px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              {fmtCost(nodeCost(c))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Multimodal completed-operation detail ──────────────────────────

/**
 * Live Runs media panel. Passes the complete run-detail graph plus the exact
 * selected media span identity so lineage includes relation-connected
 * ingest/index/retrieval nodes outside the media subtree. Catalog join is
 * resolved inside `projectMediaRunFromNode` from exact recorded `definitionId`
 * attributes only; when identity is absent the panel shows unavailable.
 */
function MediaRunDetailSection({
  node,
  detail,
  kind,
  isRoot,
  trace,
}: {
  node: ObservabilityRunDetailNode;
  detail: ObservabilityRunDetail;
  kind: PrimitiveKind;
  isRoot: boolean;
  trace: Trace | undefined;
}) {
  const { navigate } = useNavigation();
  const selectedMediaSpanId =
    typeof node.spanId === "string" && node.spanId.length > 0
      ? node.spanId
      : node.id;
  const mediaView = projectMediaRunFromNode(detail.root, selectedMediaSpanId);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SelectedSpanHeader
        node={node}
        detail={detail}
        kind={kind}
        isRoot={isRoot}
        trace={trace}
      />
      <div className="flex-1 overflow-auto px-4 py-4">
        <SectionErrorBoundary title="Media" compact resetKey={node.id}>
          {mediaView ? (
            <MediaRunPanel
              view={mediaView}
              onOpenCatalog={
                mediaView.catalogJoin.status === "joined"
                  ? (definitionId) =>
                      navigate({
                        view: "library-index",
                        promptId: definitionId,
                      })
                  : undefined
              }
            />
          ) : (
            <OperationReportCard node={node} />
          )}
        </SectionErrorBoundary>
      </div>
    </div>
  );
}

// ─── Header + KPI strip ─────────────────────────────────────────────

function SelectedSpanHeader({
  node,
  detail,
  kind,
  isRoot,
  trace,
}: {
  node: ObservabilityRunDetailNode;
  detail: ObservabilityRunDetail;
  kind: PrimitiveKind;
  isRoot: boolean;
  trace: Trace | undefined;
}) {
  const accent = primitiveAccentVar(node.primitive);
  const dur = fmtDuration(nodeDuration(node));

  // Resolve which model(s) backed this span — node.model is empty in the
  // new backend; the routed model lives on output.meta.actualModelId.
  const models = useMemo(() => resolveModels(node), [node]);
  const distinctModels = Array.from(
    new Set(models.map((m) => m.model).filter((m): m is string => !!m)),
  );
  const distinctProviders = Array.from(
    new Set(models.map((m) => m.provider).filter((p): p is string => !!p)),
  );
  const primaryModel = node.model || shortModelId(distinctModels[0]);
  const primaryProvider = node.provider || distinctProviders[0];

  // Pull tokens/cost from node + descendants — root spans don't have own
  // usage; their tokens are the sum of leaf generation events.
  const inputTok =
    readMetric(node, "inputTokens") ?? readMetricDeep(node, "inputTokens");
  const outputTok =
    readMetric(node, "outputTokens") ?? readMetricDeep(node, "outputTokens");
  const totalTok =
    readMetric(node, "totalTokens") ??
    readMetricDeep(node, "totalTokens") ??
    ((inputTok ?? 0) + (outputTok ?? 0) || undefined);
  const cachedTok =
    readMetric(node, "cachedInputTokens") ??
    readMetricDeep(node, "cachedInputTokens");
  const reasoningTok =
    readMetric(node, "reasoningTokens") ??
    readMetricDeep(node, "reasoningTokens");
  const costN =
    readMetric(node, "cost") ??
    readMetric(node, "costUsd") ??
    readMetricDeep(node, "cost") ??
    readMetricDeep(node, "costUsd");
  const tps = tokensPerSecond(node);
  const ttftMs = isRoot ? trace?.streaming?.ttftMs : undefined;
  const finishReasons = finishReasonsFor(node);

  const tokens = fmtTokens(totalTok);
  const cost = fmtCost(costN);

  return (
    <>
      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-2 font-mono text-[12px]"
        style={{
          padding: "11px 24px",
          borderBottom: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg)",
        }}
      >
        <Chip tone={statusTone(node.status)} dot>
          {statusLabel(node.status)}
        </Chip>
        <span style={{ color: accent, fontWeight: 600 }}>{node.primitive}</span>
        {(primaryProvider || primaryModel) && (
          <>
            <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
            <span title={distinctModels.join(", ")}>
              {[primaryProvider, primaryModel].filter(Boolean).join(" · ")}
              {distinctModels.length > 1 && (
                <span style={{ color: "var(--devtools-fg-faint)" }}>
                  {" +"}
                  {distinctModels.length - 1}
                </span>
              )}
            </span>
          </>
        )}
        {node.display?.label && node.display.label !== node.primitive && (
          <>
            <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
            <span style={{ color: "var(--devtools-fg-muted)" }}>
              {node.display.label}
            </span>
          </>
        )}
        {finishReasons.length > 0 && (
          <>
            <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
            {finishReasons.map((r) => (
              <Chip
                key={r}
                tone={
                  r === "stop" ? "ok" : r === "tool-calls" ? "iris" : "muted"
                }
                mono
              >
                {r}
              </Chip>
            ))}
          </>
        )}
        <span
          className="ml-auto flex items-center gap-2"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          <span>{dur}</span>
          {tokens !== "—" && (
            <>
              <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
              <span>{tokens}</span>
            </>
          )}
          {cost !== "—" && (
            <>
              <span style={{ color: "var(--devtools-fg-faint)" }}>·</span>
              <span>{cost}</span>
            </>
          )}
        </span>
      </div>

      {/* Status banners for first-class waiting/blocked states */}
      {node.status === "suspended" && (
        <div
          className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-[12px]"
          style={{
            background: "var(--devtools-iris-soft)",
            color: "var(--devtools-iris)",
            borderBottom: "1px solid var(--devtools-border)",
          }}
        >
          <Icon name="alert" size={13} color="var(--devtools-iris)" />
          <span className="font-semibold">
            {node.primitive === "flow.suspension"
              ? `Suspended at: ${(findAttribute(node, "suspendPoint") as string | undefined) ?? node.name ?? "unknown"}`
              : "Suspended"}
          </span>
          <span
            className="font-mono opacity-80"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            {node.primitive === "flow.suspension"
              ? `flowId · ${(findAttribute(node, "flowId") as string | undefined) ?? "—"}`
              : "waiting for a signal — plan approval, human review, or resume"}
          </span>
        </div>
      )}
      {node.status === "blocked" && (
        <div
          className="flex flex-shrink-0 items-center gap-3 px-4 py-2.5 text-[12px]"
          style={{
            background: "var(--devtools-danger-soft)",
            color: "var(--devtools-danger)",
            borderBottom: "1px solid var(--devtools-border)",
          }}
        >
          <Icon name="alert" size={13} color="var(--devtools-danger)" />
          <span className="font-semibold">Blocked</span>
          <span
            className="font-mono opacity-80"
            style={{ color: "var(--devtools-fg-muted)" }}
          >
            guardrail / constraint / safety check stopped execution
          </span>
        </div>
      )}

      {/* KPI strip — run/generation only. Agents intentionally omit it: the
          design's agent screen has no metric cards, and the full stats live in
          the Inspector rail. */}
      {(kind === "run" || kind === "generation") && (
        <div
          className="grid flex-shrink-0 gap-2 px-4 py-3"
          style={{
            gridTemplateColumns: "repeat(4, 1fr)",
            borderBottom: "1px solid var(--devtools-border)",
          }}
        >
          <Kpi
            label="Duration"
            value={dur}
            sublabel={
              ttftMs != null
                ? `TTFT ${ttftMs}ms`
                : node.timing?.selfMs != null && node.timing?.childrenMs != null
                  ? `${fmtDuration(node.timing.selfMs)} self · ${fmtDuration(node.timing.childrenMs)} children`
                  : node.timing?.selfMs != null
                    ? `${fmtDuration(node.timing.selfMs)} self`
                    : undefined
            }
          />
          <Kpi
            label="Tokens"
            value={tokens}
            sublabel={
              inputTok != null || outputTok != null
                ? `${fmtTokens(inputTok)} in · ${fmtTokens(outputTok)} out${cachedTok ? ` · ${fmtTokens(cachedTok)} cached` : ""}`
                : reasoningTok
                  ? `${fmtTokens(reasoningTok)} reasoning`
                  : undefined
            }
          />
          <Kpi
            label="Cost"
            value={cost}
            sublabel={
              reasoningTok
                ? `${fmtTokens(reasoningTok)} reasoning tok`
                : totalTok && costN
                  ? `${((costN / totalTok) * 1_000_000).toFixed(2)} ¢/Mtok`
                  : undefined
            }
          />
          <Kpi
            label={
              isRoot
                ? "Spans"
                : kind === "generation"
                  ? "Throughput"
                  : "Children"
            }
            value={
              kind === "generation" && tps != null
                ? `${tps.toFixed(1)}t/s`
                : String(
                    isRoot
                      ? detail.run.spanCount
                      : (node.children?.length ?? 0),
                  )
            }
            sublabel={
              kind === "generation" && tps != null
                ? outputTok != null
                  ? `${fmtTokens(outputTok)} out / ${fmtDuration(node.timing?.selfMs ?? nodeDuration(node))}`
                  : undefined
                : isRoot
                  ? `${detail.counts.attachedDetails ?? 0} attached`
                  : undefined
            }
          />
        </div>
      )}
    </>
  );
}

function TabStrip({
  tabs,
  active,
  onSelect,
  counts,
}: {
  tabs: readonly InspectTabId[];
  active: InspectTabId;
  onSelect: (id: InspectTabId) => void;
  counts: Partial<Record<InspectTabId, number>>;
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center px-4 text-[12px]"
      style={{
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      {tabs.map((id) => {
        const isActive = id === active;
        const count = counts[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className="-mb-px flex items-center gap-1.5 px-2.5 py-2"
            style={{
              color: isActive ? "var(--devtools-fg)" : "var(--devtools-fg-muted)",
              borderBottom: isActive
                ? "2px solid var(--devtools-crux)"
                : "2px solid transparent",
              fontWeight: isActive ? 600 : 450,
              fontFamily: "var(--devtools-mono)",
            }}
          >
            {TAB_LABEL[id]}
            {count != null && count > 0 && (
              <span
                className="rounded-[3px] px-[5px] py-px font-mono text-[10px]"
                style={{
                  color: isActive ? "var(--devtools-crux)" : "var(--devtools-fg-faint)",
                  background: isActive
                    ? "var(--devtools-crux-soft)"
                    : "var(--devtools-bg-muted)",
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Panel ──────────────────────────────────────────────────────────

interface SpanDetailPanelProps {
  detail: ObservabilityRunDetail | null;
  selectedNodeId: string | null;
  onSelectSpan?: (id: string) => void;
  trace: Trace | undefined;
  judges: readonly JudgeEventData[];
}

export function SpanDetailPanel({
  detail,
  selectedNodeId,
  onSelectSpan,
  trace,
  judges,
}: SpanDetailPanelProps) {
  if (!detail?.root) {
    return (
      <div
        className="px-4 py-3 text-[12px]"
        style={{ color: "var(--devtools-fg-muted)" }}
      >
        Run detail unavailable.
      </div>
    );
  }

  const node = findNode(detail.root, selectedNodeId) ?? detail.root;
  const focusedSpanId = node.spanId || node.id;
  const focusedTokenEvents = useObservabilitySpanEvents(
    detail.run.runId,
    focusedSpanId,
    {
      name: "token.chunk",
      limit: 512,
    },
  );
  const focusedTokenChunks = useMemo(
    () => tokenChunksFromEvents(focusedTokenEvents.events),
    [focusedTokenEvents.events],
  );
  const isRoot = node.id === detail.root.id;
  // The root shows *its primitive's* card (agent.run → agent loop, composition
  // → composition card, …), not a generic "run" view (spec §4). `isRoot` still
  // drives run-level aggregates in the sub-header.
  const kind = classifyPrimitive(node.primitive);
  // The run root leads with Turn Explanation rolled up across the run, when the
  // projection emitted per-turn reports; its existing tabs stay one click away.
  const runHasInsight = isRoot && collectTurnReports(detail.root).length > 0;
  const tabs: readonly InspectTabId[] = runHasInsight
    ? ["insight", ...tabsForKind(kind)]
    : tabsForKind(kind);

  const [activeTab, setActiveTab] = useState<InspectTabId>(tabs[0]);
  // Reset to default tab whenever the selected node changes (so switching
  // from a generation to a tool.call doesn't leave us on a hidden tab).
  const tabKey = `${node.id}:${tabs.join(",")}`;
  const [tabsForId, setTabsForId] = useState<string>(tabKey);
  if (tabsForId !== tabKey) {
    setTabsForId(tabKey);
    if (!tabs.includes(activeTab)) {
      setActiveTab(tabs[0]);
    }
  }

  const spanJudges = useMemo(
    () =>
      judges.filter(
        (j) =>
          !j.traceId ||
          j.traceId === node.traceId ||
          j.traceId === detail.run.runId,
      ),
    [judges, node.traceId, detail.run.runId],
  );

  const counts: Partial<Record<InspectTabId, number>> = useMemo(() => {
    const c: Partial<Record<InspectTabId, number>> = {};
    const scope = isRoot ? detail.root : node;

    if (tabs.includes("context")) {
      const partsLen = trace?.inspect?.system?.parts?.length ?? 0;
      const hasPrompt = trace?.inspect?.prompt ? 1 : 0;
      const v = partsLen + hasPrompt;
      if (v > 0) c.context = v;
    }
    if (tabs.includes("tools")) {
      const t = gatherDescendants(scope).filter(
        (n) =>
          n.primitive === "tool.call" || n.primitive === "tool" || n.toolName,
      ).length;
      if (t > 0) c.tools = t;
    }
    if (tabs.includes("retrieval")) {
      const r = gatherDescendants(scope).filter(
        (n) =>
          n.primitive.startsWith("retrieval.") ||
          n.primitive === "embedding.call" ||
          n.primitive.startsWith("memory."),
      ).length;
      if (r > 0) c.retrieval = r;
    }
    if (tabs.includes("scores")) {
      const scoreArt = findArtifact(node, "score.report");
      const scoreCount = Array.isArray(scoreArt?.preview)
        ? (scoreArt!.preview as unknown[]).length
        : Array.isArray((scoreArt?.preview as { scores?: unknown })?.scores)
          ? (scoreArt!.preview as { scores: unknown[] }).scores.length
          : spanJudges.length;
      if (scoreCount > 0) c.scores = scoreCount;
    }
    if (tabs.includes("citations")) {
      const citationArt = findArtifact(node, "citation.report");
      const citations = Array.isArray(citationArt?.preview)
        ? (citationArt!.preview as unknown[]).length
        : Array.isArray(
              (citationArt?.preview as { citations?: unknown })?.citations,
            )
          ? (citationArt!.preview as { citations: unknown[] }).citations.length
          : 0;
      if (citations > 0) c.citations = citations;
    }
    if (tabs.includes("children")) {
      c.children = node.children?.length ?? 0;
    }
    return c;
  }, [node, detail.root, isRoot, spanJudges, tabs, trace]);

  // Generation gets its own ground-up detail (own sub-header + Output·Context),
  // not the generic header/tab-strip (spec §4 + §9).
  if (kind === "generation") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <GenerationDetail
          node={node}
          trace={trace}
          isRoot={isRoot}
          providedTools={providedToolsForNode(detail.root, node.id)}
        />
      </div>
    );
  }

  // Multimodal completed operations get a purpose-built panel: summary,
  // safe descriptors, attempts, transcript/absence, and lineage. Never
  // falls through to generic JSON / media playback surfaces.
  // Catalog join is resolved from exact recorded definition identity on the
  // media span (definitionId); when absent, the panel shows an explicit
  // unavailable state — completed-media capture does not invent Catalog ids.
  if (node.primitive?.startsWith("media.")) {
    return (
      <MediaRunDetailSection
        node={node}
        detail={detail}
        kind={kind}
        isRoot={isRoot}
        trace={trace}
      />
    );
  }

  // Agent gets its own detail — instructions · tools · nested loop, no tab strip
  // or Output (design `CardAgent`). Sub-header carries the identity/metrics.
  if (kind === "agent") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SelectedSpanHeader
          node={node}
          detail={detail}
          kind={kind}
          isRoot={isRoot}
          trace={trace}
        />
        <div className="flex-1 overflow-auto px-4 py-4">
          <SectionErrorBoundary title="Agent" compact resetKey={node.id}>
            <AgentCard node={node} onSelect={(id) => onSelectSpan?.(id)} />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  // Flow runs and flow steps: the step sequence (`FlowCard`) IS the content —
  // no tab strip. A step shows its own children the same way (nested up to 3).
  if (node.primitive === "flow.run" || node.primitive === "flow.step") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SelectedSpanHeader
          node={node}
          detail={detail}
          kind={kind}
          isRoot={isRoot}
          trace={trace}
        />
        <div className="flex-1 overflow-auto px-4 py-4">
          <SectionErrorBoundary title="Flow" compact resetKey={node.id}>
            <FlowCard node={node} onSelect={(id) => onSelectSpan?.(id)} />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  // Deferred work keeps lifecycle and host completion class on one card so
  // handler-returned streaming overlap stays explicit.
  if (node.primitive === "defer.scheduled" || node.primitive === "defer.run") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SelectedSpanHeader
          node={node}
          detail={detail}
          kind={kind}
          isRoot={isRoot}
          trace={trace}
        />
        <div className="flex-1 overflow-auto px-4 py-4">
          <SectionErrorBoundary
            title="Deferred work"
            compact
            resetKey={node.id}
          >
            <DeferredWorkCard node={node} />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  if (node.primitive === "mcp.connect" || node.primitive === "mcp.discover") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SelectedSpanHeader
          node={node}
          detail={detail}
          kind={kind}
          isRoot={isRoot}
          trace={trace}
        />
        <div className="flex-1 overflow-auto px-4 py-4">
          <SectionErrorBoundary
            title="MCP preparation"
            compact
            resetKey={node.id}
          >
            <McpPreparationNode node={node} />
          </SectionErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SelectedSpanHeader
        node={node}
        detail={detail}
        kind={kind}
        isRoot={isRoot}
        trace={trace}
      />
      {/* The tabs rail only earns its space once there's a choice to make:
          a single-tab span renders its one surface directly, no chrome. */}
      {tabs.length > 1 && (
        <TabStrip
          tabs={tabs}
          active={activeTab}
          onSelect={setActiveTab}
          counts={counts}
        />
      )}
      {activeTab === "insight" ? (
        <RunInsight
          root={detail.root}
          onSelectSpan={(id) => onSelectSpan?.(id)}
        />
      ) : (
        /* Per-tab error boundary: a broken render on one tab (malformed
          message payload, unexpected handoff shape, etc.) shouldn't
          take down the rest of the span detail panel. `resetKey` ties
          the boundary to the selected node + tab, so switching tabs or
          spans gives a clean retry surface. */
        <div className="flex-1 overflow-auto px-4 py-4">
          <SectionErrorBoundary
            title={`${TAB_LABEL[activeTab] ?? activeTab} tab`}
            compact
            resetKey={`${node.id}:${activeTab}`}
          >
            {activeTab === "output" && (
              <OutputTab
                node={node}
                trace={trace}
                isRoot={isRoot}
                lazyTokenChunks={focusedTokenChunks}
              />
            )}
            {activeTab === "context" && (
              <ContextTab node={node} trace={trace} isRoot={isRoot} />
            )}
            {activeTab === "tool" &&
              (node.primitive.startsWith("tool.approval") ? (
                <ApprovalCard node={node} />
              ) : (
                <ToolSpanTab node={node} onSelectSpan={onSelectSpan} />
              ))}
            {activeTab === "memory" && <MemoryTab node={node} />}
            {activeTab === "handoff" && (
              <HandoffTab node={node} onSelect={(id) => onSelectSpan?.(id)} />
            )}
            {activeTab === "tools" && (
              <ToolsTab scope={isRoot ? detail.root : node} />
            )}
            {activeTab === "retrieval" &&
              (node.primitive.startsWith("embedding.") ? (
                <EmbeddingCard node={node} />
              ) : kind === "retrieval" ? (
                <RetrievalSpanTab node={node} />
              ) : (
                <RetrievalAggregateTab scope={isRoot ? detail.root : node} />
              ))}
            {activeTab === "scores" && (
              <ScoresTab node={node} judges={spanJudges} />
            )}
            {activeTab === "citations" && <CitationsTab node={node} />}
            {activeTab === "eval" &&
              (node.primitive === "eval.run" ? (
                <EvalRunCard
                  node={node}
                  onSelect={(id) => onSelectSpan?.(id)}
                />
              ) : (
                <EvalCard node={node} />
              ))}
            {activeTab === "report" &&
              (node.primitive.startsWith("plan.") ? (
                <PlanCard node={node} />
              ) : (
                <OperationReportCard node={node} />
              ))}
            {activeTab === "composition" && <CompositionCard node={node} />}
            {activeTab === "children" && (
              <ChildrenTab node={node} onSelect={(id) => onSelectSpan?.(id)} />
            )}
          </SectionErrorBoundary>
        </div>
      )}
    </div>
  );
}
