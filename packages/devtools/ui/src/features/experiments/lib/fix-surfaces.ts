/**
 * Fix-surface chip derivation (blueprint §12.1).
 *
 * A failing cell's core-owned `suggestedFixSurfaces` become chips that point
 * the user at where the regression most likely lives. Clicking a chip
 * navigates to the covered Project Index definition when the evaluation
 * declares one. Pure, so it is unit-tested directly.
 */

import type { ChipTone } from '@/qw/shell/primitives'
import type { QualityFailureArtifact, QualitySuggestedFixSurface } from '@/types'

/** One rendered fix-surface chip. */
export interface FixSurfaceChip {
  surface: QualitySuggestedFixSurface
  label: string
  tone: ChipTone
  /** Project Index definition id to navigate to, when the eval covers one. */
  target?: string
}

const FIX_SURFACE_META: Record<QualitySuggestedFixSurface, { label: string; tone: ChipTone }> = {
  prompt: { label: 'Prompt', tone: 'iris' },
  context: { label: 'Context', tone: 'iris' },
  retriever: { label: 'Retriever', tone: 'plum' },
  'tool-schema': { label: 'Tool schema', tone: 'gold' },
  handoff: { label: 'Handoff', tone: 'gold' },
  judge: { label: 'Judge', tone: 'warn' },
  flake: { label: 'Flake', tone: 'muted' },
  unknown: { label: 'Unknown', tone: 'muted' },
}

/**
 * Map a failure artifact's suggested fix surfaces to chips. Every chip shares
 * the same navigation target — the first Project Index definition the
 * evaluation covers — because the surfaces describe *what kind* of fix the one
 * covered definition needs.
 */
export function fixSurfaceChips(
  failure: Pick<QualityFailureArtifact, 'suggestedFixSurfaces' | 'covers'>,
): FixSurfaceChip[] {
  const target = failure.covers?.[0]
  return failure.suggestedFixSurfaces.map((surface) => {
    const meta = FIX_SURFACE_META[surface] ?? { label: String(surface), tone: 'muted' as ChipTone }
    return { surface, label: meta.label, tone: meta.tone, target }
  })
}

/** Find the failure artifact for one experiment cell (identity is case×variant×trial). */
export function failureForCell(
  failures: readonly QualityFailureArtifact[] | undefined,
  cell: { caseId: string; variantName: string; trial: number },
): QualityFailureArtifact | undefined {
  return failures?.find(
    (f) => f.caseId === cell.caseId && f.variant === cell.variantName && f.trial === cell.trial,
  )
}

/**
 * The de-duplicated fix-surface chips across a case group's failing cells —
 * one chip per surface, first occurrence wins (keeps its covered target). Used
 * for the collapsed failing-first row where the whole case is one line.
 */
export function groupFixSurfaceChips(
  failures: readonly QualityFailureArtifact[] | undefined,
  cells: readonly { caseId: string; variantName: string; trial: number }[],
): FixSurfaceChip[] {
  const seen = new Set<string>()
  const chips: FixSurfaceChip[] = []
  for (const cell of cells) {
    const f = failureForCell(failures, cell)
    if (!f) continue
    for (const chip of fixSurfaceChips(f)) {
      if (seen.has(chip.surface)) continue
      seen.add(chip.surface)
      chips.push(chip)
    }
  }
  return chips
}
