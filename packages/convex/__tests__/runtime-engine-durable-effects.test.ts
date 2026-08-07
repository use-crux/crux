import type {
  RuntimeEffectStorePort,
  RuntimeStoreAdapter,
} from '@use-crux/core/runtime'
import {
  runStoreEffectAdapterTests,
  type RunStoreEffectAdapterTestsOptions,
} from '@use-crux/core/runtime/testing'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import schema from '../src/component/schema'
import { convexRuntimeStore, type ConvexRuntimeComponent } from '../src/runtime'
import type { ConvexCtxPort } from '../src/store'

const modules = {
  '../src/component/_generated/server.ts': () =>
    import('../src/component/_generated/server'),
  '../src/component/runtime/composite_effects.ts': () =>
    import('../src/component/runtime/composite_effects'),
  '../src/component/runtime/effect_lifecycle.ts': () =>
    import('../src/component/runtime/effect_lifecycle'),
  '../src/component/runtime/effect_claims.ts': () =>
    import('../src/component/runtime/effect_claims'),
  '../src/component/runtime/effect_records.ts': () =>
    import('../src/component/runtime/effect_records'),
  '../src/component/runtime/effect_recovery.ts': () =>
    import('../src/component/runtime/effect_recovery'),
  '../src/component/runtime/effects.ts': () =>
    import('../src/component/runtime/effects'),
} satisfies Record<string, () => Promise<unknown>>

type EffectsStore = RuntimeStoreAdapter & {
  readonly effects: RuntimeEffectStorePort
}

function createStore(): EffectsStore {
  const t = convexTest({ schema, modules })
  const ctx: ConvexCtxPort = {
    runQuery: async <TResult>() => undefined as TResult,
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      t.mutation(
        ref as FunctionReference<
          'mutation',
          'public',
          Record<string, unknown>,
          TResult
        >,
        args,
      ),
  }
  const store = convexRuntimeStore({ ctx, component: runtimeComponent() })
  if (!store.effects) {
    throw new TypeError('Convex durable Effects store is missing.')
  }
  return store as EffectsStore
}

const options: RunStoreEffectAdapterTestsOptions<EffectsStore> = {
  name: 'Convex component',
  createStore,
  substrateAtomicTransact: true,
  effectCapabilities: {
    atomicOperations: { support: 'supported' },
    multiOperationTransactions: {
      support: 'unsupported',
      reason:
        'Convex commits each logical Effect operation as one component mutation; arbitrary adapter transact callbacks cannot share that transaction.',
    },
    crashFencing: { support: 'supported' },
    reconstruction: { support: 'supported' },
    recoveryClaims: { support: 'supported' },
  },
}

runStoreEffectAdapterTests(options)

function runtimeComponent(): ConvexRuntimeComponent {
  return {
    runtime: {
      state: {},
      events: {},
      waiters: {},
      timers: {},
      outbox: {},
      leases: {},
      composite_effects: {
        run: makeFunctionReference('runtime/composite_effects:run'),
      },
    },
  }
}
