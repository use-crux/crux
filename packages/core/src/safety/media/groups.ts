/** A retained group whose presence requires members in another group. */
export interface MediaGroupDependency {
  readonly retainedGroupId: string
  readonly requiredGroupId: string
  readonly minimumRequired: number
}

/** Return the first violated dependency in declaration order. */
export function findMediaGroupDependencyViolation(
  dependencies: readonly MediaGroupDependency[],
  retainedByGroup: ReadonlyMap<string, number>,
): MediaGroupDependency | undefined {
  return dependencies.find(
    (dependency) =>
      count(retainedByGroup, dependency.retainedGroupId) > 0 &&
      count(retainedByGroup, dependency.requiredGroupId) < dependency.minimumRequired,
  )
}

function count(groups: ReadonlyMap<string, number>, groupId: string): number {
  const value = groups.get(groupId)
  if (value === undefined) throw new Error(`Missing media retention group "${groupId}".`)
  return value
}
