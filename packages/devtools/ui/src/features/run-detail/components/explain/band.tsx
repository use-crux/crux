/**
 * `Explain` tab layout atoms: the verdict-band scan chips, the section band
 * header, the quiet "→ open <Tab>" deep-link, and the sub-header signal strip.
 *
 * These carry no status vocabulary of their own — they arrange the evidence.
 * Chip tone (the report's neutral/info/warning/danger) is resolved to the app
 * {@link ChipTone} palette here so the rest of the Explain UI speaks one tone
 * language.
 */

import type { ReactNode } from 'react'
import { Icon } from '@/qw/shell/Icon'
import type { IconName } from '@/qw/shell/nav'
import type { ChipTone } from '@/qw/shell/primitives'
import { TONE_VAR } from '@/features/run-detail/lib/families'
import type { ExplainChip, ExplainChipTone } from '@/features/run-detail/lib/explain/chips'

/** Map a report chip tone to the app palette. */
export function chipToneToTone(tone: ExplainChipTone): ChipTone {
  switch (tone) {
    case 'info':
      return 'crux'
    case 'warning':
      return 'warn'
    case 'danger':
      return 'danger'
    case 'neutral':
    default:
      return 'muted'
  }
}

const SOFT: Record<ChipTone, string> = {
  muted: 'var(--qw-bg-elev)',
  crux: 'var(--qw-crux-soft)',
  danger: 'var(--qw-danger-soft)',
  warn: 'var(--qw-warn-soft)',
  ok: 'var(--qw-ok-soft)',
  iris: 'var(--qw-iris-soft)',
  gold: 'var(--qw-gold-soft)',
  plum: 'var(--qw-plum-soft)',
}
const LINE: Record<ChipTone, string> = {
  muted: 'var(--qw-border)',
  crux: 'var(--qw-crux-line)',
  danger: 'var(--qw-danger-line)',
  warn: 'var(--qw-warn-line)',
  ok: 'var(--qw-ok-line)',
  iris: 'var(--qw-iris-line)',
  gold: 'var(--qw-gold-line)',
  plum: 'var(--qw-plum-line)',
}

/** A clickable verdict-band scan chip that jumps to its section. */
export function SummaryChip({ chip, active, onClick }: { chip: ExplainChip; active?: boolean; onClick?: () => void }) {
  const tone = chipToneToTone(chip.tone)
  const accent = TONE_VAR[tone]
  const fg = tone === 'muted' && !active ? 'var(--qw-fg-muted)' : accent
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="inline-flex items-center gap-[6px] rounded-[6px] px-[10px] py-[4px] text-[12px] font-medium whitespace-nowrap transition-colors"
      style={{
        cursor: onClick ? 'pointer' : 'default',
        color: fg,
        background: active ? SOFT[tone] : chip.hollow ? 'transparent' : 'var(--qw-bg-elev)',
        boxShadow: `inset 0 0 0 1px ${active ? LINE[tone] : 'var(--qw-border)'}`,
      }}
    >
      {chip.icon ? (
        <Icon name={chip.icon} size={13} color={fg} />
      ) : (
        <span
          className="inline-block size-[6px] rounded-full"
          style={{ background: chip.hollow ? 'transparent' : accent, boxShadow: chip.hollow ? `inset 0 0 0 1px ${accent}` : 'none' }}
        />
      )}
      <span>{chip.label}</span>
      {chip.value != null && (
        <span className="font-mono text-[12px] font-semibold" style={{ color: accent }}>
          {chip.value}
        </span>
      )}
    </button>
  )
}

/** A section band header — eyebrow + count + italic hint + a quiet right slot. */
export function SecBand({
  icon,
  title,
  count,
  hint,
  right,
  tone = 'muted',
}: {
  icon?: IconName
  title: string
  count?: ReactNode
  hint?: string
  right?: ReactNode
  tone?: ChipTone
}) {
  return (
    <div className="mb-3 flex items-center gap-[10px]">
      {icon && <Icon name={icon} size={15} color={tone === 'muted' ? 'var(--qw-fg-muted)' : TONE_VAR[tone]} />}
      <span className="text-[13.5px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--qw-fg)' }}>
        {title}
      </span>
      {count != null && (
        <span className="font-mono text-[11.5px]" style={{ color: 'var(--qw-fg-faint)' }}>
          {count}
        </span>
      )}
      {hint && (
        <span className="text-[12px] italic" style={{ fontFamily: 'var(--qw-serif)', color: 'var(--qw-fg-muted)' }}>
          {hint}
        </span>
      )}
      <div className="h-px flex-1" style={{ background: 'var(--qw-border)' }} />
      {right}
    </div>
  )
}

/** "→ open <Tab>" — Explain summarises; the deep tab holds the full evidence. */
export function OpenTabLink({ label, onClick }: { label: string; onClick?: () => void }) {
  if (!onClick) return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-[4px] font-mono text-[10.5px]"
      style={{ color: 'var(--qw-crux)', cursor: 'pointer' }}
    >
      {label}
      <Icon name="arrowRight" size={11} color="var(--qw-crux)" />
    </button>
  )
}

/** The always-on sub-header signal strip — the warning, visible on any tab. */
export function SignalStrip({ chips }: { chips: readonly ExplainChip[] }) {
  if (chips.length === 0) return null
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-6 pb-2.5"
      style={{ borderBottom: '1px solid var(--qw-border)', background: 'var(--qw-bg)' }}
    >
      <span
        className="font-mono text-[9px] uppercase tracking-[0.12em]"
        style={{ color: 'var(--qw-fg-faint)' }}
      >
        signals
      </span>
      {chips.map((c) => {
        const tone = chipToneToTone(c.tone)
        return (
          <span
            key={c.id}
            className="inline-flex items-center gap-[5px] rounded-[4px] px-[7px] py-[2px] font-mono text-[10px] whitespace-nowrap"
            style={{ color: TONE_VAR[tone], background: SOFT[tone], boxShadow: `inset 0 0 0 1px ${LINE[tone]}` }}
          >
            {c.icon && <Icon name={c.icon} size={10} color={TONE_VAR[tone]} />}
            {c.label}
            {c.value != null ? ` ${c.value}` : ''}
          </span>
        )
      })}
    </div>
  )
}
