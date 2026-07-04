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

  ports.runtime.update(runtimePatch)

  let runtime: CruxRuntime = { ...ports.runtime.get() }
  const plugins =
    plan.plugins.length > 0
      ? ports.plugins.apply(plan.plugins, runtime)
      : undefined
  if (plugins) {
    runtime = { ...plugins.runtime }
    ports.runtime.set(runtime)
  }

  if (plan.tokenizer) {
    ports.tokenizer.setTokenizer(plan.tokenizer)
  }

  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
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
