import type { PromptRegistry } from '../configure'
import type { RuntimeBridgeConnection } from '../../runtime-bridge'
import type { CruxHooks } from '../runtime'
import { defaultRuntimeConfigCruxFactory } from './crux'
import type { RequiredPorts } from './ports'
import type { RuntimeConfigInstallation, RuntimeConfigPlan } from './types'

/**
 * Apply a runtime config plan through side-effect ports.
 *
 * Installation owns global hook patching, observability transport state,
 * tokenizer mutation, plugin application, bridge connection, and final Crux
 * object teardown. Prompt registry construction remains in `configure()`.
 */
export function installRuntimeConfigPlan(
  plan: RuntimeConfigPlan,
  ports: RequiredPorts,
): RuntimeConfigInstallation {
  let restoreObservability: (() => void) | undefined
  const previousHooks = ports.hooks.get()
  const hooksPatch = { ...plan.hooksPatch }

  if (plan.observability.kind === 'identity') {
    restoreObservability = ports.observability.configure({
      identity: plan.observability.identity,
      ...observabilityPolicyOptions(plan.observability),
    })
  } else if (plan.observability.kind === 'owned') {
    restoreObservability = ports.observability.configure({
      transport: plan.observability.transport,
      delivery: plan.observability.delivery,
      ...observabilityPolicyOptions(plan.observability),
      ...(Object.hasOwn(plan.observability, 'identity')
        ? { identity: plan.observability.identity }
        : {}),
    })
  } else if (plan.observability.kind === 'http') {
    const transport = ports.observability.createHttpTransport({
      serverUrl: plan.observability.serverUrl,
      token: plan.observability.token,
    })
    hooksPatch.observabilityTransport = transport
    hooksPatch.observabilityDelivery = plan.observability.delivery
    restoreObservability = ports.observability.configure({
      transport,
      delivery: plan.observability.delivery,
      ...observabilityPolicyOptions(plan.observability),
      ...(Object.hasOwn(plan.observability, 'identity')
        ? { identity: plan.observability.identity }
        : {}),
    })
  } else if (
    plan.observability.feedbackDestination !== undefined ||
    plan.observability.redactPaths !== undefined
  ) {
    restoreObservability = ports.observability.configure(
      observabilityPolicyOptions(plan.observability),
    )
  }

  let hooks: CruxHooks = { ...previousHooks, ...hooksPatch }
  const plugins =
    plan.plugins.length > 0
      ? ports.plugins.apply(plan.plugins, hooks)
      : undefined
  if (plugins) {
    hooks = { ...plugins.hooks }
  }

  const layerPatch = changedHookFields(previousHooks, hooks, hooksPatch)
  const layerToken = ports.hooks.pushLayer(layerPatch)

  if (plan.tokenizer) {
    ports.tokenizer.setTokenizer(plan.tokenizer)
  }

  let bridge: RuntimeBridgeConnection | undefined
  let registry: PromptRegistry | undefined
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    bridge?.dispose()
    registry?.dispose()
    ports.hooks.restoreLayer(layerToken)
    void plugins?.dispose()
    restoreObservability?.()
  }

  return {
    hooks: Object.freeze({ ...hooks }),
    restore,
    connectBridge(promptRegistry: PromptRegistry) {
      void promptRegistry
      bridge = ports.bridge.connect(plan.bridgeOptions, {
        logger: typeof console !== 'undefined' ? console : undefined,
      })
      return bridge
    },
    createCrux(promptRegistry, connectedBridge) {
      registry = promptRegistry
      bridge = connectedBridge
      const cruxFactory = ports.crux ?? defaultRuntimeConfigCruxFactory
      return cruxFactory.create(plan.config, {
        ...promptRegistry,
        dispose: restore,
      })
    },
  }
}

function observabilityPolicyOptions(
  plan: import('./types').RuntimeConfigObservabilityPlan,
) {
  return {
    ...(plan.feedbackDestination !== undefined
      ? { feedbackDestination: plan.feedbackDestination }
      : {}),
    ...(plan.redactPaths !== undefined
      ? { redactPaths: plan.redactPaths }
      : {}),
  }
}

function changedHookFields(
  previousHooks: Readonly<CruxHooks>,
  hooks: Readonly<CruxHooks>,
  forcedPatch: Partial<CruxHooks>,
): Partial<CruxHooks> {
  const keys = new Set<keyof CruxHooks>([
    ...(Object.keys(previousHooks) as (keyof CruxHooks)[]),
    ...(Object.keys(hooks) as (keyof CruxHooks)[]),
    ...(Object.keys(forcedPatch) as (keyof CruxHooks)[]),
  ])
  const patch: Partial<CruxHooks> = {}
  for (const key of keys) {
    if (previousHooks[key] !== hooks[key] || key in forcedPatch) {
      copyHookField(patch, hooks, key)
    }
  }
  return patch
}

function copyHookField<K extends keyof CruxHooks>(
  target: Partial<CruxHooks>,
  source: Readonly<CruxHooks>,
  key: K,
): void {
  target[key] = source[key]
}
