import { resetHooks } from '@use-crux/core'
import { runSessionConformanceTests } from '@use-crux/core/runtime/testing'
import { afterEach } from 'vitest'
import { createConvexSessionConformanceHarness } from './runtime-session-conformance-fixture'

afterEach(() => resetHooks())

runSessionConformanceTests({
  name: 'Convex',
  createHarness: createConvexSessionConformanceHarness,
})
