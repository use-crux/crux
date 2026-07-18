/**
 * Index v2 design tokens.
 *
 * The Index v2 design uses a restrained editorial palette authored with
 * inline styles against a token object. Rather than rewrite every rule into
 * Tailwind, we mirror
 * that token object here — but each value points at the app's existing
 * `--devtools-*` CSS custom properties so light/dark theming flows through the
 * single source of truth in `index.css` (no second palette, no seam with
 * the DevtoolsShell chrome). The blue / plum / gold families and `iris-line`
 * were added to `index.css` for this view.
 *
 * Because every value is a `var(--devtools-*)` reference resolved at paint time,
 * `T` is a plain constant — `useTokens()` exists only to keep the port of
 * the design's `const t = useTokens()` call sites mechanical.
 */

export interface CatTokens {
  bg: string;
  bgElev: string;
  bgMuted: string;
  bgSubtle: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  border: string;
  borderStrong: string;
  crux: string;
  cruxSoft: string;
  cruxLine: string;
  danger: string;
  dangerSoft: string;
  warn: string;
  warnSoft: string;
  ok: string;
  okSoft: string;
  iris: string;
  irisSoft: string;
  irisLine: string;
  blue: string;
  blueSoft: string;
  blueLine: string;
  plum: string;
  plumSoft: string;
  plumLine: string;
  gold: string;
  goldSoft: string;
  goldLine: string;
  grid: string;
  mono: string;
  sans: string;
  serif: string;
}

export const T: CatTokens = {
  bg: "var(--devtools-bg)",
  bgElev: "var(--devtools-bg-elev)",
  bgMuted: "var(--devtools-bg-muted)",
  bgSubtle: "var(--devtools-bg-subtle)",
  fg: "var(--devtools-fg)",
  fgMuted: "var(--devtools-fg-muted)",
  fgFaint: "var(--devtools-fg-faint)",
  border: "var(--devtools-border)",
  borderStrong: "var(--devtools-border-strong)",
  crux: "var(--devtools-crux)",
  cruxSoft: "var(--devtools-crux-soft)",
  cruxLine: "var(--devtools-crux-line)",
  danger: "var(--devtools-danger)",
  dangerSoft: "var(--devtools-danger-soft)",
  warn: "var(--devtools-warn)",
  warnSoft: "var(--devtools-warn-soft)",
  ok: "var(--devtools-ok)",
  okSoft: "var(--devtools-ok-soft)",
  iris: "var(--devtools-iris)",
  irisSoft: "var(--devtools-iris-soft)",
  irisLine: "var(--devtools-iris-line)",
  blue: "var(--devtools-blue)",
  blueSoft: "var(--devtools-blue-soft)",
  blueLine: "var(--devtools-blue-line)",
  plum: "var(--devtools-plum)",
  plumSoft: "var(--devtools-plum-soft)",
  plumLine: "var(--devtools-plum-line)",
  gold: "var(--devtools-gold)",
  goldSoft: "var(--devtools-gold-soft)",
  goldLine: "var(--devtools-gold-line)",
  grid: "var(--devtools-grid)",
  mono: "var(--devtools-mono)",
  sans: "var(--devtools-sans)",
  serif: "var(--devtools-serif)",
};

export type Tone =
  | "crux"
  | "iris"
  | "ok"
  | "warn"
  | "danger"
  | "blue"
  | "plum"
  | "gold"
  | "muted";

export interface ToneColor {
  fg: string;
  soft: string;
  line: string;
}

/** Resolve a family/status tone to its `{ fg, soft, line }` triple. */
export function toneColor(t: CatTokens, tone: Tone): ToneColor {
  const map: Record<Tone, ToneColor> = {
    crux: { fg: t.crux, soft: t.cruxSoft, line: t.cruxLine },
    iris: { fg: t.iris, soft: t.irisSoft, line: t.irisLine },
    ok: { fg: t.ok, soft: t.okSoft, line: t.okSoft },
    warn: { fg: t.warn, soft: t.warnSoft, line: t.warnSoft },
    danger: { fg: t.danger, soft: t.dangerSoft, line: t.dangerSoft },
    blue: { fg: t.blue, soft: t.blueSoft, line: t.blueLine },
    plum: { fg: t.plum, soft: t.plumSoft, line: t.plumLine },
    gold: { fg: t.gold, soft: t.goldSoft, line: t.goldLine },
    muted: { fg: t.fgMuted, soft: t.bgMuted, line: t.border },
  };
  return map[tone] ?? map.muted;
}

/** Hook form, for a mechanical port of the design's `const t = useTokens()`. */
export function useTokens(): CatTokens {
  return T;
}
