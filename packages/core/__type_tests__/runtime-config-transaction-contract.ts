/**
 * Type-level contract for the internal runtime config transaction boundary.
 *
 * This file intentionally imports through a relative internal path. The
 * transaction is not a public package export; the contract here protects the
 * deep module's typed ports and readonly plan shape while keeping `config()` as
 * the only user-facing project configuration API.
 */

import { expectTypeOf } from 'vitest'
import {
  createRuntimeConfigTransaction,
  planRuntimeConfig,
  type RuntimeConfigPlan,
  type RuntimeConfigTransactionPorts,
} from '../src/runtime/config-transaction'
import type { CruxHooks, HooksLayerToken } from '../src/runtime/runtime'

const plan = planRuntimeConfig({
  env: { CRUX_INDEX: '0' },
  config: {
    generation: {
      middleware: async (args, next) => next(args),
      tokenizer: (text) => text.length,
    },
    plugins: [
      {
        name: 'typed-plugin',
        install(hooks) {
          expectTypeOf(hooks).toEqualTypeOf<Readonly<CruxHooks>>()
          return { semanticCacheInstalled: true }
        },
      },
    ],
  },
})

expectTypeOf(plan).toEqualTypeOf<RuntimeConfigPlan>()
expectTypeOf(plan.inert).toEqualTypeOf<boolean>()
expectTypeOf(plan.config).toMatchTypeOf<Readonly<{ generation?: unknown }>>()
expectTypeOf(plan.hooksPatch).toMatchTypeOf<Partial<CruxHooks>>()
expectTypeOf(plan.configureOptions.prompts).not.toBeAny()
expectTypeOf(plan.plugins).toMatchTypeOf<RuntimeConfigPlan['plugins']>()
expectTypeOf(plan.plugins[0]?.install).toMatchTypeOf<
  ((hooks: Readonly<CruxHooks>) => unknown) | undefined
>()

const layerToken = {} as HooksLayerToken

const ports = {
  hooks: {
    get: () => ({ semanticCacheInstalled: true }),
    set(hooks) {
      expectTypeOf(hooks).toEqualTypeOf<CruxHooks>()
    },
    update(patch) {
      expectTypeOf(patch).toEqualTypeOf<Partial<CruxHooks>>()
    },
    pushLayer(patch) {
      expectTypeOf(patch).toEqualTypeOf<Partial<CruxHooks>>()
      return layerToken
    },
    restoreLayer(token) {
      expectTypeOf(token).toEqualTypeOf<HooksLayerToken>()
    },
  },
  plugins: {
    apply(plugins, hooks) {
      expectTypeOf(plugins).toMatchTypeOf<
        ReadonlyArray<{ readonly name: string }>
      >()
      expectTypeOf(hooks).toEqualTypeOf<CruxHooks>()
      return {
        hooks,
        async dispose() {},
      }
    },
  },
} satisfies RuntimeConfigTransactionPorts

const transaction = createRuntimeConfigTransaction({ config: {} }, ports)

expectTypeOf(transaction.inert).toEqualTypeOf<boolean>()
expectTypeOf(transaction.config).toMatchTypeOf<Readonly<{}>>()
expectTypeOf(transaction.apply().hooks).toMatchTypeOf<Readonly<CruxHooks>>()
