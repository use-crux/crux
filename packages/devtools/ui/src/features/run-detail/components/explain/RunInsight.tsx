/**
 * Run insight — Turn Explanation rolled up across a whole run, failing-first.
 *
 * Shown as the run root's leading center view. The backend emits one
 * {@link TurnDecisionReport} per generation turn under a shared run id; this
 * view derives the roll-up (no separate run-level projection) and lists the
 * turns needing attention first. Selecting a turn navigates to its span, which
 * opens that turn's Explain by default.
 */

import { Icon } from "@/devtools/shell/Icon";
import { TONE_VAR } from "@/features/run-detail/lib/families";
import {
  aggregateRun,
  collectTurnEntries,
  type TurnEntry,
} from "@/features/run-detail/lib/explain/rollup";
import { warningChips } from "@/features/run-detail/lib/explain/chips";
import { turnHasWarningSignal } from "@/features/run-detail/lib/explain/signals";
import type { ObservabilityRunDetailNode } from "@/types";
import { KindTag, StatusPill } from "../atoms";
import { chipToneToTone } from "./band";

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-[10px] px-3.5 py-3"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px solid var(--devtools-border)",
      }}
    >
      <span
        className="font-mono text-[9.5px] uppercase tracking-[0.06em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        {label}
      </span>
      <span
        className="text-[20px] font-semibold tracking-[-0.02em]"
        style={{ color: tone ?? "var(--devtools-fg)" }}
      >
        {value}
      </span>
    </div>
  );
}

function MiniChips({ entry }: { entry: TurnEntry }) {
  const chips = warningChips(entry.report).slice(0, 4);
  if (chips.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => {
        const tone = chipToneToTone(c.tone);
        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-[4px] rounded-[3px] px-[6px] py-px font-mono text-[9.5px] whitespace-nowrap"
            style={{
              color: TONE_VAR[tone],
              background: `var(--devtools-${tone === "muted" ? "bg-muted" : tone + "-soft"})`,
            }}
          >
            {c.icon && <Icon name={c.icon} size={9} color={TONE_VAR[tone]} />}
            {c.label}
            {c.value != null ? ` ${c.value}` : ""}
          </span>
        );
      })}
    </span>
  );
}

function TurnRow({
  entry,
  onSelect,
}: {
  entry: TurnEntry;
  onSelect: (id: string) => void;
}) {
  const t = entry.report.turn;
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.id)}
      className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-(--devtools-bg-muted)/50"
      style={{ borderBottom: "1px solid var(--devtools-border)" }}
    >
      <KindTag kind="generation" size={9} />
      <div className="w-[180px] flex-shrink-0 min-w-0">
        <div
          className="truncate text-[12.5px] font-medium"
          style={{ color: "var(--devtools-fg)" }}
        >
          {t.name ?? t.id}
        </div>
        {t.model && (
          <div
            className="truncate font-mono text-[10px]"
            style={{ color: "var(--devtools-fg-faint)" }}
          >
            {t.model}
          </div>
        )}
      </div>
      <StatusPill status={t.status ?? "ok"} />
      {t.readout ? (
        <span
          className="min-w-0 flex-1 truncate text-[12px] italic"
          style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-muted)" }}
        >
          {t.readout}
        </span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      <MiniChips entry={entry} />
      <Icon name="arrowRight" size={13} color="var(--devtools-fg-faint)" />
    </button>
  );
}

export function RunInsight({
  root,
  onSelectSpan,
}: {
  root: ObservabilityRunDetailNode;
  onSelectSpan: (id: string) => void;
}) {
  const entries = collectTurnEntries(root);
  const agg = aggregateRun(entries.map((e) => e.report));
  // Failing-first: turns needing attention float to the top, tree order within.
  const ordered = [...entries].sort(
    (a, b) =>
      Number(turnHasWarningSignal(b.report)) -
      Number(turnHasWarningSignal(a.report)),
  );
  const covered = agg.total > 0 ? `${agg.covered}/${agg.total}` : "—";

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div className="mx-auto px-6 py-5" style={{ maxWidth: 960 }}>
        <div className="mb-4 flex items-baseline gap-2.5">
          <span
            className="font-mono text-[10.5px] uppercase tracking-[0.16em]"
            style={{ color: "var(--devtools-crux)" }}
          >
            Run insight
          </span>
          <span
            className="text-[12.5px] italic"
            style={{
              fontFamily: "var(--devtools-serif)",
              color: "var(--devtools-fg-muted)",
            }}
          >
            Turn Explanation rolled up across this run.
          </span>
        </div>

        {entries.length === 0 ? (
          <div
            className="rounded-[10px] px-4 py-3 text-[12.5px]"
            style={{
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg-faint)",
            }}
          >
            No turn explanations were projected for this run yet.
          </div>
        ) : (
          <>
            <div
              className="mb-5 grid gap-2.5"
              style={{ gridTemplateColumns: "repeat(6, minmax(0, 1fr))" }}
            >
              <Stat label="turns" value={agg.turns} />
              <Stat
                label="attention"
                value={agg.needAttention}
                tone={agg.needAttention > 0 ? "var(--devtools-warn)" : "var(--devtools-ok)"}
              />
              <Stat
                label="dropped"
                value={agg.dropped}
                tone={agg.dropped > 0 ? "var(--devtools-danger)" : undefined}
              />
              <Stat
                label="stale used"
                value={agg.staleUsed}
                tone={agg.staleUsed > 0 ? "var(--devtools-warn)" : undefined}
              />
              <Stat
                label="fallback"
                value={agg.fallback}
                tone={agg.fallback > 0 ? "var(--devtools-warn)" : undefined}
              />
              <Stat
                label="protected"
                value={covered}
                tone={
                  agg.total > 0 && agg.covered < agg.total
                    ? "var(--devtools-warn)"
                    : "var(--devtools-ok)"
                }
              />
            </div>

            <div className="mb-3 flex items-center gap-2.5">
              <Icon name="trace" size={15} color="var(--devtools-fg-muted)" />
              <span className="text-[13.5px] font-semibold">Turns</span>
              <span
                className="text-[12px] italic"
                style={{
                  fontFamily: "var(--devtools-serif)",
                  color: "var(--devtools-fg-muted)",
                }}
              >
                needing attention first — select one to explain it
              </span>
              <div
                className="h-px flex-1"
                style={{ background: "var(--devtools-border)" }}
              />
            </div>
            <div
              className="overflow-hidden rounded-[10px]"
              style={{
                background: "var(--devtools-bg)",
                border: "1px solid var(--devtools-border)",
              }}
            >
              {ordered.map((entry) => (
                <TurnRow key={entry.id} entry={entry} onSelect={onSelectSpan} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
