import type { ConfigureOptions } from '../configure'
import type { CruxConfig } from '../config-types'
import type { CruxRuntime } from '../runtime'
import type { RuntimeConfigEnvironment, RuntimeConfigPlan, RuntimeConfigTransactionInput } from './types'

/**
 * Build a side-effect-free runtime config plan.
 *
 * The plan owns lifecycle decisions that should be easy to test without
 * touching globals: index mode, runtime patches, observability ownership,
 * devtools fallback behavior, plugin ordering, and bridge inputs.
 */
export function planRuntimeConfig(input: RuntimeConfigTransactionInput): RuntimeConfigPlan {
  const config = Object.freeze({ ...input.config })
  const inert = isIndexMode(input.env)
  const store = config.persistence?.store
  const observability = config.observability
  const observabilityCapture = observabilityCapturePolicy(observability)
  const ownsObservability =
    observability?.enabled === false || observability?.transport !== undefined || observability?.serverUrl !== undefined

  const runtimePatch: Partial<CruxRuntime> = {
    ...(store ? { store } : {}),
    ...(config.generation?.middleware ? { middleware: config.generation.middleware } : {}),
    ...(ownsObservability
      ? {
          observabilityTransport: observability?.transport,
          observabilityDelivery: observability?.enabled !== false ? observability?.delivery : undefined,
        }
      : {}),
    ...(observabilityCapture ? { observabilityCapture } : {}),
  }

  const configureOptions: ConfigureOptions = {
    prompts: [],
    devtools: ownsObservability ? undefined : config.devtools,
    autoEscape: config.generation?.autoEscape,
    securityWarnings: config.generation?.securityWarnings,
    plugins: ownsObservability ? undefined : config.plugins ? [...config.plugins] : undefined,
  }

  return {
    inert,
    config,
    runtimePatch,
    ownsObservability,
    observability: planObservability(config),
    configureOptions,
    bridgeOptions: {
      devtools: config.devtools,
      quality: config.quality,
      store,
    },
    plugins: ownsObservability && config.plugins ? [...config.plugins] : [],
    tokenizer: config.generation?.tokenizer,
  }
}

function isIndexMode(env: RuntimeConfigEnvironment | undefined): boolean {
  if (env) return env.CRUX_INDEX === '1'
  return typeof process !== 'undefined' && typeof process.env === 'object' && process.env.CRUX_INDEX === '1'
}

function planObservability(config: Readonly<CruxConfig>): RuntimeConfigPlan['observability'] {
  const observability = config.observability
  if (observability?.enabled === false) return { kind: 'owned' }
  if (observability?.transport) {
    return {
      kind: 'owned',
      transport: observability.transport,
      delivery: observability.delivery,
    }
  }
  if (observability?.serverUrl) {
    return {
      kind: 'http',
      serverUrl: observability.serverUrl,
      token: observability.token,
      delivery: observability.delivery,
    }
  }
  return { kind: 'none' }
}

function observabilityCapturePolicy(
  observability: CruxConfig['observability'],
): NonNullable<CruxConfig['observability']> | undefined {
  if (!observability) return undefined
  if (observability.recordInputs === undefined && observability.recordOutputs === undefined) return undefined
  return {
    ...(observability.recordInputs !== undefined ? { recordInputs: observability.recordInputs } : {}),
    ...(observability.recordOutputs !== undefined ? { recordOutputs: observability.recordOutputs } : {}),
  }
}
