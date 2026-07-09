import { useNavigation } from '@/app/navigation/useNavigation'
import { Chip } from '@/qw/shell/primitives'
import type { FixSurfaceChip } from '../lib/fix-surfaces'

/**
 * Presentational fix-surface chip row (blueprint §12.1). One chip per suggested
 * surface; a chip with a covered Project Index definition is clickable and
 * calls `onNavigate` with that definition id. Chips render as spans, so they
 * nest safely inside the clickable case-header row. Pure (no hooks), so it is
 * SSR render-testable.
 */
export function FixSurfaceChipsView({
  chips,
  onNavigate,
}: {
  chips: readonly FixSurfaceChip[]
  onNavigate: (definitionId: string) => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((chip) => {
        const navigable = Boolean(chip.target)
        return (
          <Chip
            key={chip.surface}
            tone={chip.tone}
            title={navigable ? `Fix surface: ${chip.label} → ${chip.target}` : `Fix surface: ${chip.label}`}
            style={navigable ? { cursor: 'pointer' } : undefined}
            onClick={
              navigable
                ? (e) => {
                    e.stopPropagation()
                    onNavigate(chip.target as string)
                  }
                : undefined
            }
          >
            {chip.label}
          </Chip>
        )
      })}
    </div>
  )
}

/** Fix-surface chip row wired to app navigation (lands on the covered definition). */
export function FixSurfaceChips({ chips }: { chips: readonly FixSurfaceChip[] }) {
  const { navigate } = useNavigation()
  return (
    <FixSurfaceChipsView chips={chips} onNavigate={(promptId) => navigate({ view: 'library-index', promptId })} />
  )
}
