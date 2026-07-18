/**
 * `Explain` tab vocabulary atoms.
 *
 * The runtime read-out's status chips (freshness · cache · coverage), the
 * honesty ladder (evidence level), and the source join tags. Status is the one
 * place saturated colour leads — filled when `solid`, hollow otherwise, always
 * label + dot/glyph + tone. Evidence level and source are quiet mono metadata,
 * shown by exception. Every colour resolves through the app's `--devtools` palette via
 * {@link TONE_VAR}; nothing introduces a new hue or token.
 */

import type { ReactNode } from "react";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import type { ChipTone } from "@/devtools/shell/primitives";
import { TONE_VAR } from "@/features/run-detail/lib/families";
import {
  SOURCE_FIDELITY_BLURB,
  cacheMeta,
  coverageMeta,
  evidenceRank,
  freshnessMeta,
  sourceStatusMeta,
  type StatusMeta,
} from "@/features/run-detail/lib/explain/registries";
import type { TurnEvidenceLevel } from "@/types";

// Soft background + ring per tone, matching the shared `Chip` atom so the
// Explain chips sit in the same visual family as the rest of run-detail.
const SOFT: Record<ChipTone, string> = {
  muted: "var(--devtools-bg-muted)",
  crux: "var(--devtools-crux-soft)",
  danger: "var(--devtools-danger-soft)",
  warn: "var(--devtools-warn-soft)",
  ok: "var(--devtools-ok-soft)",
  iris: "var(--devtools-iris-soft)",
  gold: "var(--devtools-gold-soft)",
  plum: "var(--devtools-plum-soft)",
};
const LINE: Record<ChipTone, string> = {
  muted: "var(--devtools-border)",
  crux: "var(--devtools-crux-line)",
  danger: "var(--devtools-danger-line)",
  warn: "var(--devtools-warn-line)",
  ok: "var(--devtools-ok-line)",
  iris: "var(--devtools-iris-line)",
  gold: "var(--devtools-gold-line)",
  plum: "var(--devtools-plum-line)",
};

/** A filled-or-hollow status chip with an optional leading glyph + suffix. */
function StatusChip({
  meta,
  icon,
  suffix,
}: {
  meta: StatusMeta;
  icon?: IconName;
  suffix?: ReactNode;
}) {
  if (meta.hidden)
    return <span style={{ color: "var(--devtools-fg-faint)" }}>—</span>;
  const fg = meta.solid ? TONE_VAR[meta.tone] : "var(--devtools-fg-muted)";
  const glyphColor = meta.solid ? TONE_VAR[meta.tone] : "var(--devtools-fg-faint)";
  return (
    <span
      title={meta.blurb}
      className="inline-flex items-center gap-[5px] rounded-[3px] px-[6px] py-px font-mono text-[9.5px] whitespace-nowrap"
      style={{
        color: fg,
        background: meta.solid ? SOFT[meta.tone] : "transparent",
        boxShadow: `inset 0 0 0 1px ${meta.solid ? LINE[meta.tone] : "var(--devtools-border)"}`,
      }}
    >
      {icon ? (
        <Icon name={icon} size={10} color={glyphColor} />
      ) : (
        <span
          className="inline-block size-[4px] rounded-full"
          style={{
            background: meta.solid ? TONE_VAR[meta.tone] : "transparent",
            boxShadow: meta.solid ? "none" : `inset 0 0 0 1px ${glyphColor}`,
          }}
        />
      )}
      {meta.label}
      {suffix != null && (
        <span style={{ color: "var(--devtools-fg-faint)" }}>· {suffix}</span>
      )}
    </span>
  );
}

/** Freshness chip (clock) — the loud correctness axis. */
export function FreshnessChip({
  status,
  suffix,
}: {
  status: string;
  suffix?: ReactNode;
}) {
  return (
    <StatusChip meta={freshnessMeta(status)} icon="clock" suffix={suffix} />
  );
}

/** Cache chip (disk) — the calm efficiency axis, kept separate from freshness. */
export function CacheChip({
  status,
  saved,
}: {
  status: string;
  saved?: ReactNode;
}) {
  return <StatusChip meta={cacheMeta(status)} icon="db" suffix={saved} />;
}

/** Coverage chip — the protect scorecard. A nudge, never severity. */
export function CoverageChip({ status }: { status: string }) {
  return <StatusChip meta={coverageMeta(status)} />;
}

/** "N of M behaviours protected" gauge — ok-toned, filled = good. */
export function CoverageGauge({
  covered,
  total,
}: {
  covered: number;
  total: number;
}) {
  const pct = total > 0 ? covered / total : 0;
  const tone: ChipTone = pct >= 1 ? "ok" : pct > 0 ? "warn" : "muted";
  return (
    <div className="min-w-0">
      <div className="mb-[7px] flex items-center justify-between">
        <span
          className="font-mono text-[11px] uppercase tracking-[0.08em]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          behaviours protected
        </span>
        <span
          className="font-mono text-[12.5px]"
          style={{ color: TONE_VAR[tone] }}
        >
          {covered}/{total}
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--devtools-bg-muted)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${pct * 100}%`, background: TONE_VAR[tone] }}
        />
      </div>
    </div>
  );
}

/** The 3-tick honesty ladder. Degraded levels read italic + faint. */
export function EvidenceLevel({
  value,
  showLabel = true,
}: {
  value: TurnEvidenceLevel;
  showLabel?: boolean;
}) {
  const missing = value === "missing";
  const lit = evidenceRank(value) - 1; // declared→3, observed→2, inferred→1, missing→0
  const col = missing
    ? "var(--devtools-fg-faint)"
    : value === "inferred"
      ? "var(--devtools-fg-muted)"
      : "var(--devtools-fg)";
  return (
    <span
      title={`evidence · ${value}`}
      className="inline-flex items-center gap-[7px]"
    >
      <span className="inline-flex gap-[2px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="rounded-[1.5px]"
            style={{
              width: 6,
              height: 7,
              background: i < lit ? col : "transparent",
              boxShadow:
                i < lit
                  ? "none"
                  : `inset 0 0 0 1px ${missing ? "var(--devtools-border-strong)" : "var(--devtools-border)"}`,
            }}
          />
        ))}
      </span>
      {showLabel && (
        <span
          className="font-mono text-[10.5px] tracking-[0.03em]"
          style={{ color: col, fontStyle: missing ? "italic" : "normal" }}
        >
          {value}
        </span>
      )}
    </span>
  );
}

/** Source-join status tag — quiet, neutral; `used` reads filled. */
export function SourceStatusTag({ status }: { status: string }) {
  const m = sourceStatusMeta(status);
  const solid = status === "used";
  const fg = m.tone === "muted" ? "var(--devtools-fg-muted)" : TONE_VAR[m.tone];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-[3px] px-[6px] py-px font-mono text-[9.5px]"
      style={{
        color: fg,
        background: solid ? SOFT[m.tone] : "transparent",
        boxShadow: `inset 0 0 0 1px ${solid ? LINE[m.tone] : "var(--devtools-border)"}`,
      }}
    >
      <span
        className="inline-block size-[4px] rounded-full"
        style={{
          background:
            m.tone === "muted" ? "var(--devtools-fg-faint)" : TONE_VAR[m.tone],
        }}
      />
      {m.label}
    </span>
  );
}

/** Source-fidelity tag — `inferred`/`unresolved` read dashed (speculative). */
export function SourceFidelityTag({ fidelity }: { fidelity: string }) {
  const dashed = fidelity === "unresolved" || fidelity === "inferred";
  return (
    <span
      title={SOURCE_FIDELITY_BLURB[fidelity]}
      className="rounded-[3px] px-[6px] py-px font-mono text-[9.5px]"
      style={{
        color: "var(--devtools-fg-faint)",
        border: `1px ${dashed ? "dashed" : "solid"} ${dashed ? "var(--devtools-border-strong)" : "var(--devtools-border)"}`,
      }}
    >
      {fidelity}
    </span>
  );
}
