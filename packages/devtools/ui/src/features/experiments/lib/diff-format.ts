/**
 * Pure formatting for the experiment diff panel (blueprint §12.3). Tested
 * directly; the panel is a thin renderer over the §6.3 ExperimentDiff DTO.
 */

/** Signed, 2-decimal delta: `+0.07`, `-0.07`, `0.00`. */
export function formatSignedDelta(delta: number): string {
  const fixed = delta.toFixed(2)
  return delta > 0 ? `+${fixed}` : fixed
}

/** Human list of the identity components that drifted, e.g. `dataset, scorers`. */
export function driftLabel(fingerprintDrift: readonly string[]): string {
  return fingerprintDrift.join(', ')
}

/** Sort candidate experiments for the compare picker: exclude self, newest first. */
export function comparePickerOptions<T extends { experimentId: string; startedAt?: string }>(
  experiments: readonly T[],
  currentExperimentId: string,
): T[] {
  return experiments
    .filter((e) => e.experimentId !== currentExperimentId)
    .slice()
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
}
