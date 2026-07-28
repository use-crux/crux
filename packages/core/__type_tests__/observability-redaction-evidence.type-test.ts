import {
  CRUX_OBSERVABILITY_REDACTION_SURFACES,
  type CruxObservabilityRedactionEvidence,
  type CruxObservabilityRedactionSurface,
} from '../src/observability'

const knownSurface =
  'artifact.preview' satisfies CruxObservabilityRedactionSurface

// @ts-expect-error The public surface vocabulary is intentionally closed.
const unknownSurface: CruxObservabilityRedactionSurface = 'prompt.text'

const evidence = {
  applied: true,
  surfaces: ['artifact.preview', 'attributes'],
} as const satisfies CruxObservabilityRedactionEvidence

declare const readonlyEvidence: CruxObservabilityRedactionEvidence

// @ts-expect-error Runtime evidence cannot be changed after emission.
readonlyEvidence.applied = true
// @ts-expect-error Runtime evidence surfaces are readonly.
readonlyEvidence.surfaces.push('attributes')
// @ts-expect-error The canonical surface tuple is readonly.
CRUX_OBSERVABILITY_REDACTION_SURFACES.push('attributes')

void [knownSurface, unknownSurface, evidence]
