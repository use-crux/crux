/**
 * Generation detail — built to the design (`v7-parts` `GenerationDetail`,
 * spec §4 + §9). Two tabs only:
 *  - **Output** — chunk-shaded stream (pretty / tokens / raw), in-pane Grounding
 *    (citation.report), requested tool calls, finish reason; error banner if failed.
 *  - **Context** — the §9 composition pane (`ContextComposition`): base prompt +
 *    injected contributions (4 resolution states) + accumulated context + tools +
 *    budget + composition⇄preview toggle.
 *
 * Facts/quality (metrics detail, relations, scores, attributes) live in the
 * Inspector, never here.
 */

import { useEffect, useMemo, useState } from "react";
import { JsonTree } from "@/shared/components/JsonTree";
import { Chip } from "@/qw/shell/primitives";
import { Icon } from "@/qw/shell/Icon";
import type { ObservabilityRunDetailNode, Trace } from "@/types";
import {
  turnHasWarningSignal,
  turnInitialTab,
} from "@/features/run-detail/lib/explain/signals";
import { warningChips } from "@/features/run-detail/lib/explain/chips";
import { normalizeTurnDecisionReport } from "@/features/run-detail/lib/explain/report";
import { KindTag, StatStrip, StatusPill } from "./atoms";
import { ContextComposition } from "./ContextComposition";
import { ExplainTab } from "./explain/ExplainTab";
import { SignalStrip } from "./explain/band";
import {
  GovernanceTab,
  GOV_LABEL,
  presentGovernance,
  type GovType,
} from "./GenerationDecisions";
import {
  findArtifact,
  finishReasonsFor,
  fmtCost,
  fmtDuration,
  fmtTokens,
  nodeCost,
  nodeDuration,
  nodeTokens,
  readMetric,
  resolveMessages,
  resolveModels,
  resolveOutput,
  resolveSpanError,
  shortModelId,
  tokensPerSecond,
} from "../lib/span-detail-inspection";

type OutMode = "pretty" | "tokens" | "raw";
type GenTab = "explain" | "output" | "context" | GovType;

// ─── design atoms (mapped to --qw tokens) ───────────────────────────

/** A blinking caret shown at the end of a still-streaming generation. */
function StreamCaret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block animate-pulse align-text-bottom"
      style={{
        width: 7,
        height: 15,
        background: "var(--qw-crux)",
        borderRadius: 1,
      }}
    />
  );
}

/** Chunk-shaded output with inline citation superscripts (design `ChunkOutput`). */
function ChunkOutput({
  chunks,
  streaming,
}: {
  chunks: readonly { t: string; cite?: number | string | null }[];
  streaming?: boolean;
}) {
  return (
    <div
      className="text-[14.5px] leading-[1.7]"
      style={{ fontFamily: "var(--qw-serif)", color: "var(--qw-fg)" }}
    >
      {chunks.map((c, i) => (
        <span
          key={i}
          style={{
            background: i % 2 === 0 ? "var(--qw-crux-soft)" : "transparent",
            boxShadow:
              i % 2 === 0 ? "inset 0 -1px 0 var(--qw-crux-line)" : "none",
            borderRadius: 2,
            padding: "1px 0",
          }}
        >
          {c.t}
          {c.cite != null && (
            <sup
              className="font-mono"
              style={{
                fontSize: 9.5,
                color: "var(--qw-crux)",
                background: "var(--qw-crux-soft)",
                borderRadius: 3,
                padding: "1px 3px",
                margin: "0 1px",
                fontWeight: 600,
                boxShadow: "inset 0 0 0 1px var(--qw-crux-line)",
              }}
            >
              {c.cite}
            </sup>
          )}
        </span>
      ))}
      {streaming && <StreamCaret />}
    </div>
  );
}

/** Per-token tinting (design `TokenOutput`) — reveals tokenization/granularity. */
function TokenOutput({ text }: { text: string }) {
  const tints = [
    "var(--qw-crux-soft)",
    "var(--qw-iris-soft)",
    "var(--qw-ok-soft)",
    "var(--qw-warn-soft)",
    "var(--qw-danger-soft)",
  ];
  const rings = [
    "var(--qw-crux-line)",
    "var(--qw-iris)",
    "var(--qw-ok)",
    "var(--qw-warn)",
    "var(--qw-danger)",
  ];
  const tokens = text.match(/\s+|[^\s]+/g) ?? [];
  let k = 0;
  return (
    <div
      className="text-[14.5px]"
      style={{
        fontFamily: "var(--qw-serif)",
        lineHeight: 2,
        color: "var(--qw-fg)",
      }}
    >
      {tokens.map((tok, i) => {
        if (/^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const idx = k++ % tints.length;
        return (
          <span
            key={i}
            style={{
              background: tints[idx],
              boxShadow: `inset 0 0 0 1px ${rings[idx]}`,
              borderRadius: 3,
              padding: "1px 2px",
              margin: "0 0.5px",
            }}
          >
            {tok}
          </span>
        );
      })}
    </div>
  );
}

// ─── data extraction ─────────────────────────────────────────────────

interface ToolCallPart {
  toolName?: string;
  name?: string;
  args?: unknown;
  input?: unknown;
  output?: unknown;
  result?: unknown;
  status?: string;
  toolCallId?: string;
}

/** Generated tool-call card (design `v6` `ToolCallCard`) — folded into Output:
 *  header (name · callId · status · "requested by model") + args | result grid. */
function ToolCallCard({ call }: { call: ToolCallPart }) {
  const args = call.args ?? call.input;
  const result = call.output ?? call.result;
  const cells: [string, unknown][] = [["args", args]];
  if (result !== undefined) cells.push(["result", result]);
  return (
    <div
      className="overflow-hidden rounded-[8px]"
      style={{
        background: "var(--qw-bg-elev)",
        border: "1px solid var(--qw-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--qw-border)" }}
      >
        <KindTag kind="tool" primitive="tool.call" size={9} />
        <span
          className="font-mono text-[11.5px] font-medium"
          style={{ color: "var(--qw-crux)" }}
        >
          {call.toolName ?? call.name ?? "tool"}
        </span>
        {call.toolCallId && (
          <span
            className="font-mono text-[10px]"
            style={{ color: "var(--qw-fg-faint)" }}
          >
            {call.toolCallId}
          </span>
        )}
        {call.status && (
          <Chip
            tone={
              call.status === "ok" || call.status === "success" ? "ok" : "muted"
            }
            mono
          >
            {call.status}
          </Chip>
        )}
        <div className="flex-1" />
        <span
          className="font-mono text-[9.5px]"
          style={{ color: "var(--qw-fg-faint)" }}
        >
          requested by model
        </span>
      </div>
      <div
        className="grid"
        style={{ gridTemplateColumns: cells.length > 1 ? "1fr 1fr" : "1fr" }}
      >
        {cells.map(([label, obj], i) => (
          <div
            key={label}
            style={{
              borderRight:
                i === 0 && cells.length > 1
                  ? "1px solid var(--qw-border)"
                  : "none",
            }}
          >
            <div
              className="px-3 py-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em]"
              style={{
                color: "var(--qw-fg-faint)",
                background: "var(--qw-bg-muted)",
                borderBottom: "1px solid var(--qw-border)",
              }}
            >
              {label}
            </div>
            <div className="px-3 py-2.5">
              {obj !== undefined ? (
                <JsonTree data={obj as unknown} />
              ) : (
                <span
                  className="font-mono text-[11px]"
                  style={{ color: "var(--qw-fg-faint)" }}
                >
                  (none)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tool calls the model requested this turn (assistant output content parts). */
function requestedToolCalls(node: ObservabilityRunDetailNode): ToolCallPart[] {
  const msgs = resolveMessages(node).messages;
  const out: ToolCallPart[] = [];
  for (const m of msgs) {
    if (m && typeof m === "object" && !Array.isArray(m)) {
      const type = (m as { type?: unknown }).type;
      if (type === "tool-call" || type === "tool_call")
        out.push(m as ToolCallPart);
    }
  }
  return out;
}

interface CitationMarker {
  marker?: unknown;
  sourceId?: unknown;
  chunkId?: unknown;
  score?: unknown;
  grounded?: unknown;
  note?: unknown;
  // B2: anchor into the produced output text.
  start?: unknown;
  end?: unknown;
  outputQuote?: unknown;
}
function citationMarkers(node: ObservabilityRunDetailNode): CitationMarker[] {
  const preview = findArtifact(node, "citation.report")?.preview;
  if (
    preview &&
    typeof preview === "object" &&
    (preview as { kind?: unknown }).kind === "citation.report"
  ) {
    const markers = (preview as { markers?: unknown }).markers;
    if (Array.isArray(markers)) return markers as CitationMarker[];
  }
  return [];
}

/** B2: split the output text at citation anchors so each cited span gets an inline
 *  superscript. Prefers `end` char offset, then `start`, then anchoring on
 *  `outputQuote`. Returns [] when no marker resolves to a position (caller then
 *  falls back to plain sentence-chunking). */
function buildCitedChunks(
  text: string,
  citations: readonly CitationMarker[],
): { t: string; cite?: number | string | null }[] {
  const anchors: { index: number; marker: number | string }[] = [];
  for (const c of citations) {
    const marker =
      typeof c.marker === "number" || typeof c.marker === "string"
        ? c.marker
        : null;
    if (marker == null) continue;
    let idx: number | undefined;
    if (typeof c.end === "number" && c.end >= 0 && c.end <= text.length)
      idx = c.end;
    else if (
      typeof c.start === "number" &&
      c.start >= 0 &&
      c.start <= text.length
    )
      idx = c.start;
    else if (typeof c.outputQuote === "string" && c.outputQuote) {
      const q = text.indexOf(c.outputQuote);
      if (q >= 0) idx = q + c.outputQuote.length;
    }
    if (idx != null) anchors.push({ index: idx, marker });
  }
  if (anchors.length === 0) return [];
  anchors.sort((a, b) => a.index - b.index);
  const chunks: { t: string; cite?: number | string | null }[] = [];
  let pos = 0;
  for (const a of anchors) {
    const end = Math.max(pos, Math.min(a.index, text.length));
    chunks.push({ t: text.slice(pos, end), cite: a.marker });
    pos = end;
  }
  if (pos < text.length) chunks.push({ t: text.slice(pos) });
  return chunks;
}

// ─── component ──────────────────────────────────────────────────────

export function GenerationDetail({
  node,
  trace,
  isRoot,
  providedTools,
}: {
  node: ObservabilityRunDetailNode;
  trace: Trace | undefined;
  isRoot: boolean;
  providedTools?: { name: string; used: boolean }[];
}) {
  // The Turn Explanation read model, when the local projection emitted one for
  // this generation turn. Drives the leading Explain tab + the default-tab and
  // sub-header signals; absent reports leave the existing tabs untouched.
  const report = useMemo(
    () => normalizeTurnDecisionReport(node.decisionReport),
    [node.decisionReport],
  );
  const [tab, setTab] = useState<GenTab>(
    () => turnInitialTab(report) as GenTab,
  );
  const [outMode, setOutMode] = useState<OutMode>("pretty");

  // Re-pick the default tab when a different turn is selected: Explain leads for
  // a turn with a warning signal, Output otherwise. Keyed on the turn id so a
  // user's manual tab choice within one turn is preserved.
  useEffect(() => {
    setTab(turnInitialTab(report) as GenTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // Each governance type the backend folded onto this generation (routing,
  // guardrail, security, constraint, cache, compaction) gets its own tab.
  const govTabs = useMemo(() => presentGovernance(node), [node]);
  const tabs = useMemo<ReadonlyArray<GenTab>>(
    () => [
      ...(report ? (["explain"] as const) : []),
      "output",
      "context",
      ...govTabs,
    ],
    [govTabs, report],
  );
  // Guard: if the selection lands on a tab this turn doesn't have (selection
  // changed, or no report), fall back to Output instead of an empty pane.
  const activeTab: GenTab = tabs.includes(tab) ? tab : "output";

  const resolved = useMemo(
    () => resolveOutput(node, trace, isRoot),
    [node, trace, isRoot],
  );
  const spanError = useMemo(() => resolveSpanError(node), [node]);
  const text = resolved.text;
  const obj = resolved.text == null ? resolved.object : undefined;
  const metricSource = resolved.owner ?? node;
  const model = resolveModels(metricSource)[0];
  const finish = finishReasonsFor(metricSource)[0];

  const citations = useMemo(() => citationMarkers(node), [node]);
  const grounded = citations.filter((c) => c.grounded === true).length;

  const chunks = useMemo(() => {
    const raw = text ?? (obj != null ? JSON.stringify(obj, null, 2) : "");
    if (!raw) return [] as { t: string; cite?: number | string | null }[];
    // B2: prefer citation-anchored chunks when markers carry output positions.
    if (text != null) {
      const cited = buildCitedChunks(text, citations);
      if (cited.length > 0) return cited;
    }
    const parts = raw.match(/[^.!?\n]+[.!?\n]*/g) ?? [raw];
    return parts.map((t) => ({ t }));
  }, [text, obj, citations]);
  const toolCalls = useMemo(() => requestedToolCalls(node), [node]);

  const ttft = readMetric(metricSource, "ttftMs");
  const tps = tokensPerSecond(metricSource);
  const strip = [
    { label: "dur", value: fmtDuration(nodeDuration(node)) },
    ...(ttft != null ? [{ label: "ttft", value: fmtDuration(ttft) }] : []),
    ...(tps != null ? [{ label: "tps", value: Math.round(tps) }] : []),
    { label: "tok", value: fmtTokens(nodeTokens(node)) },
    { label: "cost", value: fmtCost(nodeCost(node)) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* span sub-header — metrics always on */}
      <div
        className="flex flex-shrink-0 flex-wrap items-center gap-2.5"
        style={{
          padding: "11px 24px",
          borderBottom: "1px solid var(--qw-border)",
          background: "var(--qw-bg)",
        }}
      >
        <KindTag kind="generation" primitive={node.primitive} size={9} />
        <span className="font-mono text-[12.5px] font-semibold">
          {node.display?.label ?? node.name ?? node.primitive}
        </span>
        <StatusPill status={node.status} />
        {node.status === "running" && (
          <span
            className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold"
            style={{ color: "var(--qw-crux)" }}
          >
            <span
              aria-hidden
              className="inline-block size-[6px] rounded-full animate-running-pulse"
              style={{ background: "var(--qw-crux)" }}
            />
            streaming
          </span>
        )}
        {model && (model.provider || model.model) && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--qw-iris)" }}
            title={model.model}
          >
            {[model.provider, shortModelId(model.model)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {finish && (
          <span
            className="font-mono text-[11px]"
            style={{ color: "var(--qw-fg-faint)" }}
          >
            finish · {finish}
          </span>
        )}
        <div className="flex-1" />
        <StatStrip items={strip} size={11} gap={12} />
      </div>

      {/* Triage banner — the turn's warning stays visible on any tab. Shown
          only when the turn actually needs attention, so a healthy-but-merely-
          unprotected turn doesn't carry a permanent signal strip. */}
      {report && turnHasWarningSignal(report) && (
        <SignalStrip chips={warningChips(report)} />
      )}

      {/* tabs */}
      <div
        className="flex flex-shrink-0 items-center gap-0 px-6"
        style={{
          borderBottom: "1px solid var(--qw-border)",
          background: "var(--qw-bg)",
        }}
      >
        {tabs.map((id) => {
          const on = id === activeTab;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="-mb-px flex items-center gap-1.5 px-3.5 py-2.5 font-mono text-[12.5px] capitalize"
              style={{
                color: on ? "var(--qw-fg)" : "var(--qw-fg-muted)",
                fontWeight: on ? 600 : 450,
                borderBottom: on
                  ? "2px solid var(--qw-crux)"
                  : "2px solid transparent",
              }}
            >
              {id === "explain" && (
                <Icon
                  name="sparkle"
                  size={13}
                  color={on ? "var(--qw-crux)" : "var(--qw-warn)"}
                />
              )}
              {id === "output" || id === "context" || id === "explain"
                ? id
                : GOV_LABEL[id]}
            </button>
          );
        })}
        <div className="flex-1" />
        {activeTab === "output" && text != null && (
          <div
            className="inline-flex overflow-hidden rounded-[6px] font-mono text-[10.5px]"
            style={{ boxShadow: "inset 0 0 0 1px var(--qw-border)" }}
          >
            {(["pretty", "tokens", "raw"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setOutMode(m)}
                className="px-2.5 py-[3px]"
                style={{
                  background:
                    outMode === m ? "var(--qw-crux-soft)" : "transparent",
                  color:
                    outMode === m ? "var(--qw-crux)" : "var(--qw-fg-faint)",
                  fontWeight: outMode === m ? 600 : 450,
                }}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeTab === "explain" && report ? (
        <ExplainTab
          report={report}
          availableTabs={tabs}
          onOpenTab={(id) => setTab(id as GenTab)}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="mx-auto" style={{ maxWidth: 720 }}>
            {activeTab === "output" ? (
              <OutputView
                chunks={chunks}
                text={text}
                obj={obj}
                outMode={outMode}
                spanError={spanError}
                citations={citations}
                grounded={grounded}
                toolCalls={toolCalls}
                finish={finish}
                streaming={node.status === "running"}
              />
            ) : activeTab === "context" ? (
              <ContextComposition
                node={node}
                trace={trace}
                providedTools={providedTools}
              />
            ) : (
              // activeTab is a governance type here: Explain/output/context are
              // handled above and the guard keeps `tab` within `tabs`.
              <GovernanceTab node={node} type={activeTab as GovType} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Output view ────────────────────────────────────────────────────

function OutputView({
  chunks,
  text,
  obj,
  outMode,
  spanError,
  citations,
  grounded,
  toolCalls,
  finish,
  streaming,
}: {
  chunks: readonly { t: string; cite?: number | string | null }[];
  text: string | undefined;
  obj: unknown;
  outMode: OutMode;
  spanError: ReturnType<typeof resolveSpanError>;
  citations: CitationMarker[];
  grounded: number;
  toolCalls: ToolCallPart[];
  finish: string | undefined;
  streaming: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {spanError && (
        <div
          className="rounded-[8px] px-3.5 py-3"
          style={{
            background: "var(--qw-danger-soft)",
            border: "1px solid var(--qw-danger-soft)",
          }}
        >
          <div
            className="flex items-center gap-2 font-mono text-[12px] font-semibold"
            style={{ color: "var(--qw-danger)" }}
          >
            <Icon name="alert" size={13} color="var(--qw-danger)" />
            {spanError.name ?? "Error"}
          </div>
          <div
            className="mt-1 text-[12.5px]"
            style={{ color: "var(--qw-danger)" }}
          >
            {spanError.summary}
          </div>
          {spanError.stack && (
            <pre
              className="mt-2 max-h-[220px] overflow-auto rounded-[6px] px-2.5 py-2 font-mono text-[11px]"
              style={{
                background: "var(--qw-bg-muted)",
                color: "var(--qw-fg-muted)",
              }}
            >
              {spanError.stack}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
          style={{ color: "var(--qw-crux)" }}
        >
          Output{outMode === "pretty" && chunks.length > 1 ? " · stream" : ""}
        </span>
        <div
          className="h-px flex-1"
          style={{ background: "var(--qw-border)" }}
        />
        {streaming && (
          <Chip tone="crux" dot>
            live
          </Chip>
        )}
        {citations.length > 0 && (
          <Chip tone={grounded === citations.length ? "ok" : "warn"} dot>
            grounded {grounded} / {citations.length}
          </Chip>
        )}
        {text != null && outMode !== "raw" && chunks.length > 0 && (
          <Chip tone="ok" mono>
            {chunks.length} chunk{chunks.length === 1 ? "" : "s"}
          </Chip>
        )}
      </div>

      <div
        className="rounded-[10px] px-4 py-3.5"
        style={{
          background: "var(--qw-bg-elev)",
          border: "1px solid var(--qw-border)",
        }}
      >
        {text != null ? (
          outMode === "raw" ? (
            <pre
              className="m-0 whitespace-pre-wrap font-mono text-[12px] leading-[1.7]"
              style={{ color: "var(--qw-fg-muted)" }}
            >
              {text}
            </pre>
          ) : outMode === "tokens" ? (
            <TokenOutput text={text} />
          ) : (
            <ChunkOutput chunks={chunks} streaming={streaming} />
          )
        ) : obj != null ? (
          <JsonTree data={obj} />
        ) : (
          <span className="text-[12px]" style={{ color: "var(--qw-fg-faint)" }}>
            (no output for this span)
          </span>
        )}
      </div>

      <div
        className="flex items-center gap-2 font-mono text-[11px]"
        style={{ color: "var(--qw-fg-muted)" }}
      >
        <span
          className="inline-block size-2.5 rounded-[2px]"
          style={{
            background: "var(--qw-crux-soft)",
            boxShadow: "inset 0 0 0 1px var(--qw-crux-line)",
          }}
        />
        {outMode === "pretty"
          ? citations.length > 0
            ? "chunk boundaries shaded · superscripts cite backing chunks → grounding below"
            : "chunk boundaries shaded · grounding below"
          : outMode === "tokens"
            ? "each token tinted · reveals tokenization & stream granularity"
            : "raw model output exactly as received"}
      </div>

      {/* Grounding */}
      {citations.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2.5">
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
              style={{ color: "var(--qw-crux)" }}
            >
              Grounding · {grounded} of {citations.length} cited
            </span>
            <div
              className="h-px flex-1"
              style={{ background: "var(--qw-border)" }}
            />
            {citations.length - grounded > 0 && (
              <Chip tone="warn" dot>
                {citations.length - grounded} unused
              </Chip>
            )}
          </div>
          {citations.map((c, i) => {
            const isG = c.grounded === true;
            const src =
              typeof c.sourceId === "string"
                ? c.sourceId
                : typeof c.chunkId === "string"
                  ? c.chunkId
                  : "—";
            return (
              <div
                key={i}
                className="flex items-center gap-2.5 rounded-[8px] px-3 py-2"
                style={{
                  background: "var(--qw-bg-elev)",
                  border: "1px solid var(--qw-border)",
                  opacity: isG ? 1 : 0.7,
                }}
              >
                <span
                  className="w-5 font-mono text-[11px]"
                  style={{
                    color: isG ? "var(--qw-crux)" : "var(--qw-fg-faint)",
                  }}
                >
                  {c.marker != null ? `[${String(c.marker)}]` : "—"}
                </span>
                <span className="flex-1 truncate font-mono text-[11.5px]">
                  {src}
                </span>
                {typeof c.chunkId === "string" && (
                  <span
                    className="font-mono text-[10.5px]"
                    style={{ color: "var(--qw-fg-faint)" }}
                  >
                    {c.chunkId}
                  </span>
                )}
                {isG && typeof c.score === "number" ? (
                  <Chip tone="ok" mono>
                    {c.score.toFixed(2)}
                  </Chip>
                ) : (
                  <Chip tone="warn">
                    {typeof c.note === "string" ? c.note : "unused"}
                  </Chip>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Requested tool calls */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "var(--qw-crux)" }}
          >
            Requested tool calls
          </span>
          <div
            className="h-px flex-1"
            style={{ background: "var(--qw-border)" }}
          />
          {toolCalls.length === 0 && (
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--qw-fg-faint)" }}
            >
              none this turn
            </span>
          )}
        </div>
        {toolCalls.map((tc, i) => (
          <ToolCallCard key={i} call={tc} />
        ))}
        {toolCalls.length === 0 && finish && (
          <div
            className="rounded-[8px] px-3.5 py-2.5 font-mono text-[11.5px]"
            style={{
              border: "1px dashed var(--qw-border)",
              color: "var(--qw-fg-faint)",
            }}
          >
            finish reason was{" "}
            <span style={{ color: "var(--qw-fg-muted)" }}>{finish}</span> — the
            model returned prose, not a tool call.
          </div>
        )}
      </div>
    </div>
  );
}
