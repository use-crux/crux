/**
 * Flow step identity helpers.
 *
 * Step labels are the beta durable identity used for replay and cached step
 * outputs. A single flow execution may encounter each label once; repeated
 * labels would make replay ambiguous because completed steps are keyed by
 * label.
 *
 * @module
 */

/** Tracks durable step labels encountered during one flow handler execution. */
export interface FlowStepIdentityTracker {
  /**
   * Records a step label or throws before replay/cache lookup can use an
   * ambiguous durable identity.
   *
   * @param label - The `flow.step()` label supplied by user code.
   */
  use(label: string): void
}

/** Create a tracker for duplicate `flow.step()` labels in one execution. */
export function createFlowStepIdentityTracker(): FlowStepIdentityTracker {
  const labels = new Set<string>()

  return {
    use(label) {
      if (labels.has(label)) {
        throw new Error(
          `Duplicate flow step label "${label}". Step labels are durable identities within a flow run; use a unique label for each step.`,
        )
      }
      labels.add(label)
    },
  }
}
