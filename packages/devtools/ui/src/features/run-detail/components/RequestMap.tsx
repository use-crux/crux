import { useState, useCallback } from "react";
import type { InspectResult, ContextMeta } from "@/types";
import { cn } from "@/shared/lib/utils";
import { AlertTriangleIcon, WrenchIcon, XCircleIcon } from "lucide-react";

interface RequestMapProps {
  inspect: InspectResult;
  tools?: string[];
  contextLookup: Map<string, ContextMeta>;
  onSegmentClick?: (source: string) => void;
  className?: string;
}

// Semantic color palette — prompt template is neutral, contexts cycle through distinct colors
const CONTEXT_COLORS = [
  {
    bg: "bg-(--qw-blue)",
    hover: "hover:bg-(--qw-blue)",
    text: "text-(--qw-blue)",
  },
  { bg: "bg-(--qw-ok)", hover: "hover:bg-(--qw-ok)", text: "text-(--qw-ok)" },
  {
    bg: "bg-(--qw-warn)",
    hover: "hover:bg-(--qw-warn)",
    text: "text-(--qw-warn)",
  },
  {
    bg: "bg-(--qw-iris)",
    hover: "hover:bg-(--qw-iris)",
    text: "text-(--qw-iris)",
  },
  {
    bg: "bg-(--qw-plum)",
    hover: "hover:bg-(--qw-plum)",
    text: "text-(--qw-plum)",
  },
  {
    bg: "bg-(--qw-crux)",
    hover: "hover:bg-(--qw-crux)",
    text: "text-(--qw-crux)",
  },
  {
    bg: "bg-(--qw-gold)",
    hover: "hover:bg-(--qw-gold)",
    text: "text-(--qw-gold)",
  },
  {
    bg: "bg-(--qw-blue)",
    hover: "hover:bg-(--qw-blue)",
    text: "text-(--qw-blue)",
  },
];

interface Segment {
  source: string;
  label: string;
  tokens: number;
  type: "prompt" | "context" | "user" | "tools";
  color: { bg: string; hover: string; text: string };
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function RequestMap({
  inspect,
  tools,
  contextLookup,
  onSegmentClick,
  className,
}: RequestMapProps) {
  const [hoveredSource, setHoveredSource] = useState<string | null>(null);

  // Build segments from inspect data
  const segments: Segment[] = [];
  let contextColorIdx = 0;

  // System parts (active, non-skipped)
  for (const part of inspect.system.parts) {
    if (part.skipped || part.tokens === 0) continue;

    const isPrompt = part.source === "prompt";
    const ctxId = part.source.replace(/^context:/, "");
    const label = isPrompt ? "system" : ctxId;

    segments.push({
      source: part.source,
      label,
      tokens: part.tokens,
      type: isPrompt ? "prompt" : "context",
      color: isPrompt
        ? {
            bg: "bg-zinc-500",
            hover: "hover:bg-zinc-400",
            text: "text-zinc-400",
          }
        : CONTEXT_COLORS[contextColorIdx++ % CONTEXT_COLORS.length],
    });
  }

  // User prompt
  if (inspect.prompt && inspect.prompt.tokens > 0) {
    segments.push({
      source: "user prompt",
      label: "user prompt",
      tokens: inspect.prompt.tokens,
      type: "user",
      color: {
        bg: "bg-(--qw-blue)",
        hover: "hover:bg-(--qw-blue)",
        text: "text-(--qw-blue)",
      },
    });
  }

  // Total measured tokens (for proportional sizing)
  const measuredTokens = segments.reduce((sum, s) => sum + s.tokens, 0);

  // Tools (fixed width, unmeasured)
  const hasTools = tools && tools.length > 0;

  if (segments.length === 0 && !hasTools) return null;

  const handleClick = useCallback(
    (source: string) => {
      onSegmentClick?.(source);
    },
    [onSegmentClick],
  );

  // Budget calculation
  const budgetUsed = inspect.totalTokens;
  const budgetTotal = inspect.tokenBudget;
  const budgetPct = budgetTotal ? (budgetUsed / budgetTotal) * 100 : undefined;
  const budgetColor =
    budgetPct == null
      ? ""
      : budgetPct > 90
        ? "text-(--qw-danger)"
        : budgetPct > 70
          ? "text-(--qw-warn)"
          : "text-(--qw-ok)";

  return (
    <div className={cn("space-y-2", className)}>
      {/* Stacked proportional bar */}
      <div className="flex h-8 rounded-lg overflow-hidden border border-zinc-800/60 bg-zinc-900">
        {segments.map((seg) => {
          // Proportional width, minimum 3% to stay visible
          const rawPct =
            measuredTokens > 0
              ? (seg.tokens / measuredTokens) * (hasTools ? 88 : 100)
              : 100 / segments.length;
          const pct = Math.max(rawPct, 3);
          const showLabel = pct > 8;

          return (
            <button
              key={seg.source}
              className={cn(
                "relative flex items-center justify-center transition-all duration-150 cursor-pointer border-r border-zinc-900/50 last:border-r-0",
                seg.color.bg,
                seg.color.hover,
                hoveredSource === seg.source && "brightness-110 z-10",
              )}
              style={{ width: `${pct}%` }}
              onClick={() => handleClick(seg.source)}
              onMouseEnter={() => setHoveredSource(seg.source)}
              onMouseLeave={() => setHoveredSource(null)}
            >
              {showLabel && (
                <span className="text-[10px] text-white font-medium truncate px-1.5 drop-shadow-sm">
                  {seg.label}
                </span>
              )}

              {/* Tooltip on hover */}
              {hoveredSource === seg.source && (
                <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 shadow-lg pointer-events-none">
                  {seg.source} · {seg.tokens.toLocaleString()} tok ·{" "}
                  {measuredTokens > 0
                    ? ((seg.tokens / measuredTokens) * 100).toFixed(1)
                    : 0}
                  %
                </div>
              )}
            </button>
          );
        })}

        {/* Tools segment (fixed width, distinct style) */}
        {hasTools && (
          <button
            className={cn(
              "flex items-center justify-center gap-1 bg-zinc-700 border-l border-dashed border-zinc-600 transition-colors cursor-pointer",
              "hover:bg-zinc-600",
              hoveredSource === "tools" && "bg-zinc-600",
            )}
            style={{ width: "12%", minWidth: "48px" }}
            onClick={() => handleClick("tools")}
            onMouseEnter={() => setHoveredSource("tools")}
            onMouseLeave={() => setHoveredSource(null)}
          >
            <WrenchIcon className="size-3 text-zinc-400" />
            <span className="text-[10px] text-zinc-300 font-medium">
              {tools!.length}
            </span>

            {hoveredSource === "tools" && (
              <div className="absolute -top-9 left-1/2 -translate-x-1/2 z-20 whitespace-nowrap rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-[10px] text-zinc-200 shadow-lg pointer-events-none">
                {tools!.length} tool{tools!.length !== 1 ? "s" : ""} available
              </div>
            )}
          </button>
        )}
      </div>

      {/* Summary line: token count + budget */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3">
          <span className="text-zinc-400 tabular-nums">
            {formatTokens(budgetUsed)} tokens
          </span>
          {/* Legend: compact segment key */}
          <div className="flex items-center gap-2">
            {segments.length > 1 &&
              segments.slice(0, 5).map((seg) => (
                <span key={seg.source} className="flex items-center gap-1">
                  <span
                    className={cn("w-1.5 h-1.5 rounded-sm", seg.color.bg)}
                  />
                  <span className="text-zinc-600 truncate max-w-[80px]">
                    {seg.label}
                  </span>
                </span>
              ))}
            {segments.length > 5 && (
              <span className="text-zinc-600">+{segments.length - 5}</span>
            )}
          </div>
        </div>

        {budgetTotal && budgetPct != null && (
          <span className={cn("tabular-nums font-medium", budgetColor)}>
            {formatTokens(budgetUsed)} / {formatTokens(budgetTotal)} (
            {budgetPct.toFixed(1)}%)
          </span>
        )}
      </div>

      {/* Budget progress bar (only if budget exists) */}
      {budgetTotal && budgetPct != null && (
        <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              budgetPct > 90
                ? "bg-(--qw-danger)"
                : budgetPct > 70
                  ? "bg-(--qw-warn)"
                  : "bg-(--qw-ok)",
            )}
            style={{ width: `${Math.min(budgetPct, 100)}%` }}
          />
        </div>
      )}

      {/* Dropped contexts (ghost row) */}
      {inspect.droppedContexts.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-(--qw-warn)">
          <AlertTriangleIcon className="size-3 shrink-0" />
          <span>{inspect.droppedContexts.length} dropped:</span>
          <div className="flex items-center gap-2 overflow-hidden">
            {inspect.droppedContexts.map((ctx) => (
              <span
                key={ctx.source}
                className="flex items-center gap-1 text-(--qw-warn)"
              >
                <span className="line-through">
                  {ctx.source.replace(/^context:/, "")}
                </span>
                <span className="text-zinc-600">
                  (p{ctx.priority}, {formatTokens(ctx.tokens)})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Excluded contexts (when/match conditions) */}
      {inspect.excludedContexts && inspect.excludedContexts.length > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
          <XCircleIcon className="size-3 shrink-0" />
          <span>{inspect.excludedContexts.length} excluded:</span>
          <div className="flex items-center gap-2 overflow-hidden">
            {inspect.excludedContexts.map((ctx) => (
              <span
                key={ctx.source}
                className="flex items-center gap-1 text-zinc-500/60"
              >
                <span className="line-through">
                  {ctx.source.replace(/^context:/, "")}
                </span>
                <span className="text-zinc-600">({ctx.reason})</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
