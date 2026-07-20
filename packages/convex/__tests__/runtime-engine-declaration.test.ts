import { config } from '@use-crux/core'
import {
  CruxRuntimeError,
  createRuntime,
} from '@use-crux/core/runtime'
import { getEvalHostConnectionInference } from '@use-crux/core/runtime/internal/eval-host'
import { describe, expect, it } from 'vitest'
import { CONVEX_RUNTIME_ENTRY, convex } from '../src/runtime'

describe('convex() Runtime Engine declaration', () => {
  it('declares a host-bound runtime accepted by core config', () => {
    const runtime = convex({ namespace: 'tenant-a' })
    const crux = config({ runtime })

    expect(crux.config.runtime).toMatchObject({
      kind: 'host-bound',
      id: 'convex',
      host: 'convex',
      namespace: 'tenant-a',
      entry: CONVEX_RUNTIME_ENTRY,
    })
    expect(runtime.capabilities).toMatchObject({
      events: { durable: true, cursorReads: true },
      waiters: { durable: true },
      wake: { atLeastOnce: true },
    })

    crux.dispose()
  })

  it('throws RUNTIME_HOST_ONLY when executed outside Convex handlers', () => {
    const runtime = convex()

    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(CruxRuntimeError)
    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(/RUNTIME_HOST_ONLY/)
    expect(() =>
      createRuntime({
        runtime,
        targets: {},
        startMaintenance: false,
      }),
    ).toThrowError(/createConvexRuntimeHandlers/)
  })

  it('infers only non-secret Eval host connection fields', () => {
    const crux = config({ runtime: convex() })
    const inference = getEvalHostConnectionInference(crux.config.runtime)

    expect(
      inference?.infer({
        CONVEX_SITE_URL: 'https://example.convex.site',
        CONVEX_URL: 'https://example.convex.cloud',
        CONVEX_DEPLOYMENT: 'dev:example',
        CRUX_EVAL_HOST_TOKEN: 'must-not-be-inferred',
      }),
    ).toEqual({
      url: 'https://example.convex.site',
      deploymentId: 'https://example.convex.cloud',
    })
    crux.dispose()
  })

  it('infers Eval host fields from framework-prefixed Convex variables', () => {
    const runtime = convex()
    const inference = getEvalHostConnectionInference(runtime)

    expect(
      inference?.infer({
        NEXT_PUBLIC_CONVEX_URL: 'https://example.convex.cloud',
        NEXT_PUBLIC_CONVEX_SITE_URL: 'https://example.convex.site',
      }),
    ).toEqual({
      url: 'https://example.convex.site',
      deploymentId: 'https://example.convex.cloud',
    })
  })
})
