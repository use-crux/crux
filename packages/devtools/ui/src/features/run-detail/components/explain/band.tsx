/**
 * `Explain` tab layout atoms: the verdict-band scan chips, the section band
 * header, the quiet "→ open <Tab>" deep-link, and the sub-header signal strip.
 *
 * These carry no status vocabulary of their own — they arrange the evidence.
 * Chip tone (the report's neutral/info/warning/danger) is resolved to the app
 * {@link ChipTone} palette here so the rest of the Explain UI speaks one tone
 * language.
 */

import type { ReactNode } from "react";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import type { ChipTone } from "@/devtools/shell/primitives";
import { TONE_VAR } from "@/features/run-detail/lib/families";
import type {
  ExplainChip,
  ExplainChipTone,
} from "@/features/run-detail/lib/explain/chips";

/** Map a report chip tone to the app palette. */
export function chipToneToTone(tone: ExplainChipTone): ChipTone {
  switch (tone) {
    case "info":
      return "crux";
    case "warning":
      return "warn";
    case "danger":
      return "danger";
    case "neutral":
    default:
      return "muted";
  }
}

const SOFT: Record<ChipTone, string> = {
  muted: "var(--devtools-bg-elev)",
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

/** A clickable verdict-band scan chip that jumps to its section. */
export function SummaryChip({
  chip,
  active,
  onClick,
}: {
  chip: ExplainChip;
  active?: boolean;
  onClick?: () => void;
}) {
  const tone = chipToneToTone(chip.tone);
  const accent = TONE_VAR[tone];
  const fg = tone === "muted" && !active ? "var(--devtools-fg-muted)" : accent;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex items-center gap-[6px] rounded-[6px] px-[10px] py-[4px] text-[12px] font-medium whitespace-nowrap transition-colors"
      style={{
        cursor: onClick ? "pointer" : "default",
        color: fg,
        background: active
          ? SOFT[tone]
          : chip.hollow
            ? "transparent"
            : "var(--devtools-bg-elev)",
        boxShadow: `inset 0 0 0 1px ${active ? LINE[tone] : "var(--devtools-border)"}`,
      }}
    >
      {chip.icon ? (
        <Icon name={chip.icon} size={13} color={fg} />
      ) : (
        <span
          className="inline-block size-[6px] rounded-full"
          style={{
            background: chip.hollow ? "transparent" : accent,
            boxShadow: chip.hollow ? `inset 0 0 0 1px ${accent}` : "none",
          }}
        />
      )}
      <span>{chip.label}</span>
      {chip.value != null && (
        <span
          className="font-mono text-[12px] font-semibold"
          style={{ color: accent }}
        >
          {chip.value}
        </span>
      )}
    </button>
  );
}

/** A section band header — eyebrow + count + italic hint + a quiet right slot. */
export function SecBand({
  icon,
  title,
  count,
  hint,
  right,
  tone = "muted",
}: {
  icon?: IconName;
  title: string;
  count?: ReactNode;
  hint?: string;
  right?: ReactNode;
  tone?: ChipTone;
}) {
  return (
    <div className="mb-3 flex items-center gap-[10px]">
      {icon && (
        <Icon
          name={icon}
          size={15}
          color={tone === "muted" ? "var(--devtools-fg-muted)" : TONE_VAR[tone]}
        />
      )}
      <span
        className="text-[13.5px] font-semibold tracking-[-0.01em]"
        style={{ color: "var(--devtools-fg)" }}
      >
        {title}
      </span>
      {count != null && (
        <span
          className="font-mono text-[11.5px]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          {count}
        </span>
      )}
      {hint && (
        <span
          className="text-[12px] italic"
          style={{ fontFamily: "var(--devtools-serif)", color: "var(--devtools-fg-muted)" }}
        >
          {hint}
        </span>
      )}
      <div className="h-px flex-1" style={{ background: "var(--devtools-border)" }} />
      {right}
    </div>
  );
}

/** "→ open <Tab>" — Explain summarises; the deep tab holds the full evidence. */
export function OpenTabLink({
  label,
  onClick,
}: {
  label: string;
  onClick?: () => void;
}) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[4px] font-mono text-[10.5px]"
      style={{ color: "var(--devtools-crux)", cursor: "pointer" }}
    >
      {label}
      <Icon name="arrowRight" size={11} color="var(--devtools-crux)" />
    </button>
  );
}

/** The always-on sub-header signal strip — the warning, visible on any tab. */
export function SignalStrip({ chips }: { chips: readonly ExplainChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-6 pb-2.5"
      style={{
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        signals
      </span>
      {chips.map((c) => {
        const tone = chipToneToTone(c.tone);
        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-[5px] rounded-[4px] px-[7px] py-[2px] font-mono text-[10px] whitespace-nowrap"
            style={{
              color: TONE_VAR[tone],
              background: SOFT[tone],
              boxShadow: `inset 0 0 0 1px ${LINE[tone]}`,
            }}
          >
            {c.icon && <Icon name={c.icon} size={10} color={TONE_VAR[tone]} />}
            {c.label}
            {c.value != null ? ` ${c.value}` : ""}
          </span>
        );
      })}
    </div>
  );
}
