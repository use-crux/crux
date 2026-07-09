import { Eyebrow } from '@/qw/shell/primitives'
import type { QualityFailureArtifact } from '@/types'
import { datasetProvenanceLine } from '../lib/cell-labels'
import { fixSurfaceChips } from '../lib/fix-surfaces'
import { FixSurfaceChipsView } from './FixSurfaceChips'

/**
 * Failure Artifact panel for the CellEvidence "Why" lens (blueprint §12.1).
 * Surfaces the core-owned fix-surface chips, dataset provenance
 * (`path @ fingerprint-short`), and cassette id. The repro command lives in
 * the evidence Adapt footer (the §5.1 cellEvidenceCommand). Presentational, so
 * it is SSR render-testable.
 */
export function FailureArtifactPanel({
  failure,
  onNavigate,
}: {
  failure: QualityFailureArtifact
  onNavigate: (definitionId: string) => void
}) {
  const chips = fixSurfaceChips(failure)
  const provenance = datasetProvenanceLine(failure.datasetProvenance)
  if (chips.length === 0 && !provenance && !failure.cassetteId) return null
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[10px] px-3.5 py-3"
      style={{ background: 'var(--qw-bg-muted)', boxShadow: 'inset 0 0 0 1px var(--qw-border)' }}
    >
      {chips.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Eyebrow>Likely fix surface</Eyebrow>
          <FixSurfaceChipsView chips={chips} onNavigate={onNavigate} />
        </div>
      )}
      <div className="flex flex-col gap-1 font-mono text-[11px]" style={{ color: 'var(--qw-fg-muted)' }}>
        {provenance && (
          <span>
            <span style={{ color: 'var(--qw-fg-faint)' }}>dataset · </span>
            {provenance}
          </span>
        )}
        {failure.cassetteId && (
          <span>
            <span style={{ color: 'var(--qw-fg-faint)' }}>cassette · </span>
            {failure.cassetteId}
          </span>
        )}
      </div>
    </div>
  )
}
