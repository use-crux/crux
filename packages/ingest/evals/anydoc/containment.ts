/**
 * A Phase 3 supervisor may mint this capability only after placing one worker
 * in its dedicated cgroup v2 and verifying membership, memory, swap, pid,
 * CPU, network, and filesystem policy. The private symbol makes a plain
 * caller-provided boolean incapable of asserting that guarantee.
 */
declare const verifiedAnydocWorkerContainment: unique symbol

export interface VerifiedAnydocWorkerContainment {
  readonly [verifiedAnydocWorkerContainment]: true
}

/** Phase 2 has no supervisor, so Anydoc is never loaded. */
export function phase2AnydocWorkerContainment(): VerifiedAnydocWorkerContainment | undefined {
  return undefined
}
