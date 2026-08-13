import { describe, expect, it } from 'vitest'
import { phase2AnydocWorkerContainment } from './containment.js'

describe('Phase 2 Anydoc containment', () => {
  it('does not treat a finite parent cgroup limit as a worker containment capability', () => {
    expect(phase2AnydocWorkerContainment()).toBeUndefined()
  })
})
