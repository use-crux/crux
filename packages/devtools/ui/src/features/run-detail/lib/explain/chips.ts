/**
 * Summary chips for the `Explain` verdict band and span sub-header.
 *
 * The verdict band leads with the turn's one-line verdict, then a row of scan
 * chips that double as jump links into the body sections. The backend may emit
 * stable {@link TurnSummaryChip}s; when it does we honour them (and map their
 * filter target to a section anchor). When it does not, we derive the seven
 * canonical chips from the report's own arrays and counts so the band is never
 * blank.
 *
 * Chip tone uses the report's neutral/info/warning/danger vocabulary — the UI
 * resolves that to the app palette. Section anchors match the ids the Explain
 * tab assigns to its bands (`saw`, `considered`, `fresh`, `decisions`,
 * `protect`, `gaps`).
 */

import type { IconName } from '@/qw/shell/nav'
import type { TurnDecisionReport, TurnSummaryChip } from '@/types'
import { normalizeTurnDecisionReport, type RuntimeTurnDecisionReport } from './report'

/** Section anchor ids used by the Explain tab body. */
export type ExplainSection = 'saw' | 'considered' | 'fresh' | 'decisions' | 'source' | 'protect' | 'gaps'

/** Report chip tone vocabulary, resolved to the app palette by the UI. */
export type ExplainChipTone = NonNullable<TurnSummaryChip['tone']>

/** A scan chip in the verdict band / sub-header — view-ready. */
export interface ExplainChip {
  id: string
  label: string
  tone: ExplainChipTone
  /** Numeric badge appended after the label (counts), when meaningful. */
  value?: number
  /** Optional glyph; status-flavoured chips (cache, freshness) carry one. */
  icon?: IconName
  /** Section anchor this chip scrolls to when clicked. */
  jump?: ExplainSection
  /** Render hollow (a nudge, not a solid state) — e.g. unprotected quality. */
  hollow?: boolean
}

/** The filter target a backend chip can carry. */
type ChipFilterTarget = NonNullable<TurnSummaryChip['filter']>['target']

/** Map a backend chip filter target to an Explain body section anchor. */
function filterTargetToSection(target: ChipFilterTarget): ExplainSection {
  switch (target) {
    case 'freshness':
    case 'cache':
      return 'fresh'
    case 'coverage':
      return 'protect'
    case 'saw':
      return 'saw'
    case 'considered':
      return 'considered'
    case 'decisions':
      return 'decisions'
    case 'gaps':
      return 'gaps'
    default:
      return 'saw'
  }
}

/** Glyph for a backend chip, inferred from its filter target. */
function iconForTarget(target: string | undefined): IconName | undefined {
  if (target === 'cache') return 'db'
  if (target === 'freshness') return 'clock'
  return undefined
}

function fromBackend(chip: TurnSummaryChip): ExplainChip {
  return {
    id: chip.id,
    label: chip.label,
    tone: chip.tone ?? 'neutral',
    jump: chip.filter ? filterTargetToSection(chip.filter.target) : undefined,
    icon: iconForTarget(chip.filter?.target),
  }
}

function deriveChips(report: TurnDecisionReport): ExplainChip[] {
  const chips: ExplainChip[] = []
  const checked = report.considered.filter((c) => c.disposition === 'checked').length
  const dropped = report.considered.filter((c) => c.disposition === 'dropped').length

  chips.push({ id: 'saw', label: 'Saw', value: report.saw.length, tone: 'neutral', jump: 'saw' })
  if (checked > 0)
    chips.push({ id: 'checked', label: 'Checked', value: checked, tone: 'neutral', jump: 'considered' })
  if (dropped > 0)
    chips.push({ id: 'dropped', label: 'Dropped', value: dropped, tone: 'danger', jump: 'considered' })
  if (report.cache.some((c) => c.status === 'hit'))
    chips.push({ id: 'cache', label: 'Cache hit', tone: 'info', icon: 'db', jump: 'fresh' })
  if (report.freshness.some((f) => f.status === 'stale-used'))
    chips.push({ id: 'fresh', label: 'Freshness stale-used', tone: 'warning', icon: 'alert', jump: 'fresh' })
  if (report.decisions.some((d) => d.reason.code.startsWith('routing.fallback')))
    chips.push({ id: 'fallback', label: 'Fallback', tone: 'warning', icon: 'loop', jump: 'decisions' })
  if (report.coverage.covered < report.coverage.total)
    chips.push({
      id: 'protect',
      label: 'Quality unprotected',
      tone: 'warning',
      icon: 'spark',
      jump: 'protect',
      hollow: true,
    })
  return chips
}

/**
 * The verdict-band scan chips — backend chips when present, derived otherwise.
 */
export function summaryChips(report: TurnDecisionReport | RuntimeTurnDecisionReport): ExplainChip[] {
  const normalized = normalizeTurnDecisionReport(report)
  if (!normalized) return []
  if (normalized.summary && normalized.summary.length > 0) return normalized.summary.map(fromBackend)
  return deriveChips(normalized)
}

/** The subset of {@link summaryChips} that carry a warning, for the sub-header. */
export function warningChips(report: TurnDecisionReport | RuntimeTurnDecisionReport): ExplainChip[] {
  return summaryChips(report).filter((c) => c.tone === 'warning' || c.tone === 'danger')
}
