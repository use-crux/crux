import type { ConfigureOptions } from '../configure'
import type { CruxConfig } from '../config-types'
import type { CruxPlugin } from '../plugin'
import type { CruxHooks } from '../runtime'
import { withDevtools } from '../../observability'
import type { RuntimeConfigEnvironment, RuntimeConfigPlan, RuntimeConfigTransactionInput } from './types'

/**
 * Build a side-effect-free runtime config plan.
 *
 * The plan owns lifecycle decisions that should be easy to test without
 * touching globals: index mode, hook patches, observability ownership,
 * devtools fallback behavior, plugin ordering, and bridge inputs.
 */
export function planRuntimeConfig(input: RuntimeConfigTransactionInput): RuntimeConfigPlan {
  const config = Object.freeze({ ...input.config })
  const inert = isIndexMode(input.env)
  const records = config.persistence?.records
  const observability = config.observability
  const observabilityCapture = observabilityCapturePolicy(observability)
  const ownsObservability =
    observability?.enabled === false ||
    observability?.transport !== undefined ||
    observability?.serverUrl !== undefined

  const hooksPatch: Partial<CruxHooks> = {
    ...(records ? { records } : {}),
    ...(config.runtime ? { runtimeEngine: config.runtime } : {}),
    ...(config.generation?.middleware ? { middleware: config.generation.middleware } : {}),
    ...(ownsObservability
      ? {
          observabilityTransport: observability?.transport,
          observabilityDelivery: observability?.enabled !== false ? observability?.delivery : undefined,
        }
      : {}),
    ...(observabilityCapture ? { observabilityCapture } : {}),
  }

  const plugins = planPlugins(config, ownsObservability)

  const configureOptions: ConfigureOptions = {
    prompts: [],
    autoEscape: config.generation?.autoEscape,
    securityWarnings: config.generation?.securityWarnings,
  }

  return {
    inert,
    config,
    hooksPatch,
    ownsObservability,
    observability: planObservability(config),
    configureOptions,
    bridgeOptions: {
      devtools: config.devtools,
      records,
    },
    plugins,
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

function planPlugins(
  config: Readonly<CruxConfig>,
  ownsObservability: boolean,
): readonly CruxPlugin[] {
  const plugins = [...(config.plugins ?? [])]
  if (!ownsObservability && config.devtools?.serverUrl) {
    plugins.unshift(
      withDevtools({
        prompts: [],
        contexts: [],
        serverUrl: config.devtools.serverUrl,
        bridge: config.devtools.bridge,
        sessionId: config.devtools.sessionId,
      }),
    )
  }
  return plugins
}

function observabilityCapturePolicy(
  observability: CruxConfig['observability'],
): NonNullable<CruxConfig['observability']> | undefined {
  if (!observability) return undefined
  if (
    observability.capture === undefined &&
    observability.recordInputs === undefined &&
    observability.recordOutputs === undefined &&
    observability.redactRecord === undefined
  ) {
    return undefined
  }
  return {
    ...(observability.capture !== undefined ? { capture: observability.capture } : {}),
    ...(observability.recordInputs !== undefined ? { recordInputs: observability.recordInputs } : {}),
    ...(observability.recordOutputs !== undefined ? { recordOutputs: observability.recordOutputs } : {}),
    ...(observability.redactRecord !== undefined ? { redactRecord: observability.redactRecord } : {}),
  }
}
