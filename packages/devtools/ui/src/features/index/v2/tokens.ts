/**
 * Index v2 design tokens.
 *
 * The Index v2 design (Claude Design handoff "Crux Devtools - Quality
 * Workbench") is authored entirely with inline styles against a `t.*`
 * token object. Rather than rewrite every rule into Tailwind, we mirror
 * that token object here — but each value points at the app's existing
 * `--qw-*` CSS custom properties so light/dark theming flows through the
 * single source of truth in `index.css` (no second palette, no seam with
 * the QwShell chrome). The blue / plum / gold families and `iris-line`
 * were added to `index.css` for this view.
 *
 * Because every value is a `var(--qw-*)` reference resolved at paint time,
 * `T` is a plain constant — `useTokens()` exists only to keep the port of
 * the design's `const t = useTokens()` call sites mechanical.
 */

export interface CatTokens {
  bg: string
  bgElev: string
  bgMuted: string
  bgSubtle: string
  fg: string
  fgMuted: string
  fgFaint: string
  border: string
  borderStrong: string
  crux: string
  cruxSoft: string
  cruxLine: string
  danger: string
  dangerSoft: string
  warn: string
  warnSoft: string
  ok: string
  okSoft: string
  iris: string
  irisSoft: string
  irisLine: string
  blue: string
  blueSoft: string
  blueLine: string
  plum: string
  plumSoft: string
  plumLine: string
  gold: string
  goldSoft: string
  goldLine: string
  grid: string
  mono: string
  sans: string
  serif: string
}

export const T: CatTokens = {
  bg: 'var(--qw-bg)',
  bgElev: 'var(--qw-bg-elev)',
  bgMuted: 'var(--qw-bg-muted)',
  bgSubtle: 'var(--qw-bg-subtle)',
  fg: 'var(--qw-fg)',
  fgMuted: 'var(--qw-fg-muted)',
  fgFaint: 'var(--qw-fg-faint)',
  border: 'var(--qw-border)',
  borderStrong: 'var(--qw-border-strong)',
  crux: 'var(--qw-crux)',
  cruxSoft: 'var(--qw-crux-soft)',
  cruxLine: 'var(--qw-crux-line)',
  danger: 'var(--qw-danger)',
  dangerSoft: 'var(--qw-danger-soft)',
  warn: 'var(--qw-warn)',
  warnSoft: 'var(--qw-warn-soft)',
  ok: 'var(--qw-ok)',
  okSoft: 'var(--qw-ok-soft)',
  iris: 'var(--qw-iris)',
  irisSoft: 'var(--qw-iris-soft)',
  irisLine: 'var(--qw-iris-line)',
  blue: 'var(--qw-blue)',
  blueSoft: 'var(--qw-blue-soft)',
  blueLine: 'var(--qw-blue-line)',
  plum: 'var(--qw-plum)',
  plumSoft: 'var(--qw-plum-soft)',
  plumLine: 'var(--qw-plum-line)',
  gold: 'var(--qw-gold)',
  goldSoft: 'var(--qw-gold-soft)',
  goldLine: 'var(--qw-gold-line)',
  grid: 'var(--qw-grid)',
  mono: 'var(--qw-mono)',
  sans: 'var(--qw-sans)',
  serif: 'var(--qw-serif)',
}

export type Tone = 'crux' | 'iris' | 'ok' | 'warn' | 'danger' | 'blue' | 'plum' | 'gold' | 'muted'

export interface ToneColor {
  fg: string
  soft: string
  line: string
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
  }
  return map[tone] ?? map.muted
}

/** Hook form, for a mechanical port of the design's `const t = useTokens()`. */
export function useTokens(): CatTokens {
  return T
}
