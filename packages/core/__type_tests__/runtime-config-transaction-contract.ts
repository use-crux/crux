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
} from '../runtime/config-transaction'
import type { CruxRuntime } from '../runtime/runtime'

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
        install(runtime) {
          expectTypeOf(runtime).toEqualTypeOf<Readonly<CruxRuntime>>()
          return { semanticCacheInstalled: true }
        },
      },
    ],
  },
})

expectTypeOf(plan).toEqualTypeOf<RuntimeConfigPlan>()
expectTypeOf(plan.inert).toEqualTypeOf<boolean>()
expectTypeOf(plan.config).toMatchTypeOf<Readonly<{ generation?: unknown }>>()
expectTypeOf(plan.runtimePatch).toMatchTypeOf<Partial<CruxRuntime>>()
expectTypeOf(plan.configureOptions.prompts).not.toBeAny()
expectTypeOf(plan.plugins).toMatchTypeOf<RuntimeConfigPlan['plugins']>()
expectTypeOf(plan.plugins[0]?.install).toMatchTypeOf<((runtime: Readonly<CruxRuntime>) => unknown) | undefined>()

const ports = {
  runtime: {
    get: () => ({ semanticCacheInstalled: true }),
    set(runtime) {
      expectTypeOf(runtime).toEqualTypeOf<CruxRuntime>()
    },
    update(patch) {
      expectTypeOf(patch).toEqualTypeOf<Partial<CruxRuntime>>()
    },
  },
  plugins: {
    apply(plugins, runtime) {
      expectTypeOf(plugins).toMatchTypeOf<ReadonlyArray<{ readonly name: string }>>()
      expectTypeOf(runtime).toEqualTypeOf<CruxRuntime>()
      return {
        runtime,
        dispose() {},
      }
    },
  },
} satisfies RuntimeConfigTransactionPorts

const transaction = createRuntimeConfigTransaction({ config: {} }, ports)

expectTypeOf(transaction.inert).toEqualTypeOf<boolean>()
expectTypeOf(transaction.config).toMatchTypeOf<Readonly<{}>>()
expectTypeOf(transaction.apply().runtime).toMatchTypeOf<Readonly<CruxRuntime>>()
