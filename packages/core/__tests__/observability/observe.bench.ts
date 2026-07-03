import { afterAll, bench, describe } from 'vitest'
import {
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
  type CruxPrimitiveName,
} from '../../observability'

const primitive = 'custom.operation' satisfies CruxPrimitiveName

function recordSpanLifecycle(): void {
  const run = observe.openRun({ name: 'bench run', rootPrimitive: primitive })
  run.withContext(() => {
    const span = observe.openSpan({ name: 'bench span', family: 'custom', primitive })
    span.end()
  })
  run.end()
}

describe('observe lifecycle overhead', () => {
  afterAll(() => {
    resetObservabilityRuntime()
  })

  bench('zero-listener span lifecycle', () => {
    recordSpanLifecycle()
  })
})

describe('observe lifecycle overhead with an active subscriber', () => {
  const unsubscribe = subscribeObservability(() => undefined)

  afterAll(() => {
    unsubscribe()
    resetObservabilityRuntime()
  })

  bench('active-listener span lifecycle', () => {
    recordSpanLifecycle()
  })
})
