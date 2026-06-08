/**
 * Index v2 shell primitives — ported from the design's shared.jsx / v4-shell.jsx.
 *
 * Self-contained (Chip / Btn / Eyebrow / SectionHead) so the index reads
 * identically to the handoff. `Chip` is extended to the full eight-family
 * tone set (the design passes `tone="plum" | "gold" | "blue"`, which the
 * original six-tone Chip silently muted) via `toneColor`.
 */

import type { CSSProperties, ReactNode } from 'react'
import { T, toneColor, type Tone } from './tokens'
import { Icon } from './icons'

// ── Status / family chip ─────────────────────────────────────────────────────
export function Chip({
  tone = 'muted',
  children,
  dot = false,
  mono = false,
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  mono?: boolean
}) {
  const c = toneColor(T, tone)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 7px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        fontFamily: mono ? T.mono : T.sans,
        background: c.soft,
        color: c.fg,
        boxShadow: `inset 0 0 0 1px ${c.line}`,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {dot && <span style={{ width: 5, height: 5, borderRadius: 99, background: c.fg, display: 'inline-block' }} />}
      {children}
    </span>
  )
}

// ── Button ───────────────────────────────────────────────────────────────────
export type BtnVariant = 'primary' | 'soft' | 'ghost' | 'outline' | 'danger'
export type BtnSize = 'xs' | 'sm' | 'md'

export function Btn({
  children,
  variant = 'ghost',
  size = 'sm',
  icon,
  iconRight,
  style,
  onClick,
  title,
  disabled,
}: {
  children?: ReactNode
  variant?: BtnVariant
  size?: BtnSize
  icon?: string
  iconRight?: string
  style?: CSSProperties
  onClick?: () => void
  title?: string
  disabled?: boolean
}) {
  const variants: Record<BtnVariant, { bg: string; fg: string; ring: string }> = {
    primary: { bg: T.crux, fg: T.bg, ring: T.crux },
    soft: { bg: T.cruxSoft, fg: T.crux, ring: T.cruxLine },
    ghost: { bg: 'transparent', fg: T.fg, ring: T.border },
    outline: { bg: T.bgElev, fg: T.fg, ring: T.border },
    danger: { bg: T.dangerSoft, fg: T.danger, ring: T.dangerSoft },
  }
  const v = variants[variant]
  const sizes: Record<BtnSize, { fs: number; py: number; px: number; gap: number }> = {
    xs: { fs: 11, py: 4, px: 8, gap: 5 },
    sm: { fs: 12, py: 6, px: 10, gap: 6 },
    md: { fs: 13, py: 8, px: 14, gap: 7 },
  }
  const s = sizes[size]
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: s.gap,
        padding: `${s.py}px ${s.px}px`,
        background: v.bg,
        color: v.fg,
        boxShadow: `inset 0 0 0 1px ${v.ring}`,
        border: 'none',
        borderRadius: 6,
        fontSize: s.fs,
        fontWeight: 500,
        fontFamily: T.sans,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={s.fs + 1} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.fs + 1} />}
    </button>
  )
}

// ── Section eyebrow ──────────────────────────────────────────────────────────
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: 0,
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: T.crux,
      }}
    >
      {children}
    </p>
  )
}

// ── Section header (eyebrow + divider + right slot) ──────────────────────────
export function SectionHead({ eyebrow, right }: { eyebrow: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <div style={{ flex: 1, height: 1, background: T.border }} />
      {right}
    </div>
  )
}
