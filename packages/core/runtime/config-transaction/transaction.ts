import { defaultRuntimeConfigCruxFactory } from './crux'
import { installRuntimeConfigPlan } from './install'
import { planRuntimeConfig } from './plan'
import { resolveRuntimeConfigPorts } from './ports'
import type {
  RuntimeConfigInstallation,
  RuntimeConfigTransaction,
  RuntimeConfigTransactionInput,
  RuntimeConfigTransactionPorts,
} from './types'

/**
 * Create a runtime config transaction from user config and optional ports.
 *
 * The transaction separates pure planning from effectful installation so
 * config lifecycle rules can be tested without coupling tests to global state.
 */
export function createRuntimeConfigTransaction(
  input: RuntimeConfigTransactionInput,
  ports: RuntimeConfigTransactionPorts = {},
): RuntimeConfigTransaction {
  const plan = planRuntimeConfig(input)
  const resolvedPorts = resolveRuntimeConfigPorts(ports)

  return {
    inert: plan.inert,
    config: plan.config,
    configureOptions: plan.configureOptions,
    apply(): RuntimeConfigInstallation {
      if (plan.inert) {
        return {
          runtime: Object.freeze({}),
          restore() {},
          connectBridge() {
            return undefined
          },
          createCrux(registry) {
            const cruxFactory = resolvedPorts.crux ?? defaultRuntimeConfigCruxFactory
            return cruxFactory.create(plan.config, registry)
          },
        }
      }
      return installRuntimeConfigPlan(plan, resolvedPorts)
    },
    createCrux(registry) {
      const cruxFactory = resolvedPorts.crux ?? defaultRuntimeConfigCruxFactory
      return registry ? cruxFactory.create(plan.config, registry) : cruxFactory.createInert(plan.config)
    },
  }
}
