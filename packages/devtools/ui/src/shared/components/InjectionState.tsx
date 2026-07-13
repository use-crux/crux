/**
 * Shared presentation vocabulary for context-injection outcomes.
 *
 * Catalog shows aggregated authored-source observations while Run Detail shows
 * one execution. Both planes use these components so state labels and visual
 * semantics cannot drift between features.
 */

type InjectionTone = "ok" | "warn" | "danger" | "muted";

export type InjectState =
  | "active"
  | "checked"
  | "dropped"
  | "disabled"
  | "unknown";

export interface InjectStateMeta {
  readonly tone: InjectionTone;
  readonly label: string;
  /** Solid fill for the active state; quieter states use a hollow marker. */
  readonly solid: boolean;
  readonly blurb: string;
}

export const INJECT_STATE: Readonly<Record<InjectState, InjectStateMeta>> = {
  active: {
    tone: "ok",
    label: "active",
    solid: true,
    blurb: "Contributed to the assembled context.",
  },
  checked: {
    tone: "warn",
    label: "checked · not included",
    solid: false,
    blurb:
      "Evaluated but its predicate was false / branch not taken — not a drop.",
  },
  dropped: {
    tone: "danger",
    label: "dropped · budget",
    solid: false,
    blurb: "Lost the token budget at assembly time.",
  },
  disabled: {
    tone: "muted",
    label: "disabled",
    solid: false,
    blurb: "Inline-disabled for this run.",
  },
  unknown: {
    tone: "muted",
    label: "unknown",
    solid: false,
    blurb: "Older or partial telemetry — state not recorded.",
  },
};

export type InjectStateCounts = Partial<Record<InjectState, number>>;

export const INJECT_STATE_ORDER: readonly InjectState[] = [
  "active",
  "checked",
  "dropped",
  "disabled",
  "unknown",
];

/** Resolve unknown or missing telemetry to the explicit unknown state. */
export function injectStateMeta(state?: string): InjectStateMeta {
  return (
    INJECT_STATE[(state as InjectState) ?? "unknown"] ?? INJECT_STATE.unknown
  );
}

/** Return the most frequent state, using display order to break ties. */
export function dominantInjectState(counts: InjectStateCounts): InjectState {
  let best: InjectState = "unknown";
  let bestCount = -1;
  for (const state of INJECT_STATE_ORDER) {
    const count = counts[state] ?? 0;
    if (count > bestCount) {
      best = state;
      bestCount = count;
    }
  }
  return best;
}

/** Render one resolution-state chip shared by Catalog and Run Detail. */
export function InjectStateChip({
  state,
  count,
  size = "sm",
}: {
  state: string;
  count?: number;
  size?: "xs" | "sm";
}) {
  const meta = injectStateMeta(state);
  const color = injectionTone(meta.tone);
  return (
    <span
      title={meta.blurb}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: size === "xs" ? "1px 6px" : "2px 8px",
        borderRadius: 4,
        whiteSpace: "nowrap",
        fontFamily: "var(--qw-mono)",
        fontSize: size === "xs" ? 9.5 : 10.5,
        letterSpacing: "0.02em",
        color: meta.solid ? color.fg : "var(--qw-fg-muted)",
        background: meta.solid ? color.soft : "transparent",
        boxShadow: `inset 0 0 0 1px ${meta.solid ? color.line : "var(--qw-border)"}`,
      }}
    >
      <span
        style={{
          width: 4,
          height: 4,
          borderRadius: 99,
          background: meta.solid ? color.fg : "transparent",
          boxShadow: meta.solid ? undefined : `inset 0 0 0 1.5px ${color.fg}`,
          flex: "0 0 auto",
        }}
      />
      {meta.label}
      {count != null && (
        <span style={{ color: "var(--qw-fg-faint)", fontWeight: 600 }}>
          · {count}
        </span>
      )}
    </span>
  );
}

/** Render a compact distribution of resolution states. */
export function InjectStateBar({
  counts,
  height = 6,
}: {
  counts: InjectStateCounts;
  height?: number;
}) {
  const total = INJECT_STATE_ORDER.reduce(
    (sum, state) => sum + (counts[state] ?? 0),
    0,
  );
  return (
    <span
      style={{
        display: "inline-flex",
        width: "100%",
        height,
        borderRadius: 99,
        overflow: "hidden",
        background: "var(--qw-bg-subtle)",
        boxShadow: "inset 0 0 0 1px var(--qw-border)",
      }}
      title={INJECT_STATE_ORDER.filter((state) => counts[state])
        .map((state) => `${injectStateMeta(state).label}: ${counts[state]}`)
        .join(" · ")}
    >
      {total > 0 &&
        INJECT_STATE_ORDER.map((state) => {
          const count = counts[state] ?? 0;
          if (count === 0) return null;
          const meta = INJECT_STATE[state];
          const color = injectionTone(meta.tone);
          return (
            <span
              key={state}
              style={{
                width: `${(count / total) * 100}%`,
                height: "100%",
                background: meta.solid ? color.fg : color.soft,
                boxShadow: meta.solid
                  ? "none"
                  : `inset 0 0 0 1px ${color.line}`,
              }}
            />
          );
        })}
    </span>
  );
}

function injectionTone(
  tone: InjectionTone,
): Readonly<{ fg: string; soft: string; line: string }> {
  if (tone === "ok")
    return {
      fg: "var(--qw-ok)",
      soft: "var(--qw-ok-soft)",
      line: "var(--qw-ok-soft)",
    };
  if (tone === "warn")
    return {
      fg: "var(--qw-warn)",
      soft: "var(--qw-warn-soft)",
      line: "var(--qw-warn-soft)",
    };
  if (tone === "danger")
    return {
      fg: "var(--qw-danger)",
      soft: "var(--qw-danger-soft)",
      line: "var(--qw-danger-soft)",
    };
  return {
    fg: "var(--qw-fg-muted)",
    soft: "var(--qw-bg-muted)",
    line: "var(--qw-border)",
  };
}
