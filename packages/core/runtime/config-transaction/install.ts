import type { PromptRegistry } from '../configure'
import type { CruxRuntime } from '../runtime'
import { defaultRuntimeConfigCruxFactory } from './crux'
import type { RequiredPorts } from './ports'
import type { RuntimeConfigInstallation, RuntimeConfigPlan } from './types'

/**
 * Apply a runtime config plan through side-effect ports.
 *
 * Installation owns global runtime patching, observability transport state,
 * tokenizer mutation, plugin application, bridge connection, and final Crux
 * object teardown. Prompt registry construction remains in `configure()`.
 */
export function installRuntimeConfigPlan(
  plan: RuntimeConfigPlan,
  ports: RequiredPorts,
): RuntimeConfigInstallation {
  let restoreObservability: (() => void) | undefined
  const previousRuntime = ports.runtime.get()
  const runtimePatch = { ...plan.runtimePatch }

  if (plan.observability.kind === 'owned') {
    restoreObservability = ports.observability.configure({
      transport: plan.observability.transport,
      delivery: plan.observability.delivery,
    })
  } else if (plan.observability.kind === 'http') {
    const transport = ports.observability.createHttpTransport({
      serverUrl: plan.observability.serverUrl,
      token: plan.observability.token,
    })
    runtimePatch.observabilityTransport = transport
    runtimePatch.observabilityDelivery = plan.observability.delivery
    restoreObservability = ports.observability.configure({
      transport,
      delivery: plan.observability.delivery,
    })
  }

  let runtime: CruxRuntime = { ...previousRuntime, ...runtimePatch }
  const plugins =
    plan.plugins.length > 0
      ? ports.plugins.apply(plan.plugins, runtime)
      : undefined
  if (plugins) {
    runtime = { ...plugins.runtime }
  }

  const layerPatch = changedRuntimeFields(previousRuntime, runtime, runtimePatch)
  const layerToken = ports.runtime.pushLayer(layerPatch)

  if (plan.tokenizer) {
    ports.tokenizer.setTokenizer(plan.tokenizer)
  }

  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    ports.runtime.restoreLayer(layerToken)
    void plugins?.dispose()
    restoreObservability?.()
  }

  return {
    runtime: Object.freeze({ ...runtime }),
    restore,
    connectBridge(registry: PromptRegistry) {
      void registry
      return ports.bridge.connect(plan.bridgeOptions, {
        logger: typeof console !== 'undefined' ? console : undefined,
      })
    },
    createCrux(registry, bridge) {
      const cruxFactory = ports.crux ?? defaultRuntimeConfigCruxFactory
      return cruxFactory.create(plan.config, {
        ...registry,
        dispose() {
          bridge?.dispose()
          registry.dispose()
          restore()
        },
      })
    },
  }
}

function changedRuntimeFields(
  previousRuntime: Readonly<CruxRuntime>,
  runtime: Readonly<CruxRuntime>,
  forcedPatch: Partial<CruxRuntime>,
): Partial<CruxRuntime> {
  const keys = new Set<keyof CruxRuntime>([
    ...(Object.keys(previousRuntime) as (keyof CruxRuntime)[]),
    ...(Object.keys(runtime) as (keyof CruxRuntime)[]),
    ...(Object.keys(forcedPatch) as (keyof CruxRuntime)[]),
  ])
  const patch: Partial<CruxRuntime> = {}
  for (const key of keys) {
    if (previousRuntime[key] !== runtime[key] || key in forcedPatch) {
      copyRuntimeField(patch, runtime, key)
    }
  }
  return patch
}

function copyRuntimeField<K extends keyof CruxRuntime>(
  target: Partial<CruxRuntime>,
  source: Readonly<CruxRuntime>,
  key: K,
): void {
  target[key] = source[key]
}
