import type {
  CruxObservabilityTransport,
  ObservabilityDeliveryOptions,
} from '../observability'
import type { CruxCorrelators } from '../observability/correlators'
import type { RuntimeConfigInstallation } from './config-transaction'
import type { CruxHooks } from './runtime'

const PROCESS_REGISTRY_VERSION = 1
const PROCESS_REGISTRY_KEY = Symbol.for('@use-crux/core/process-registry/v1')

export type ObservabilityRegistryListener = () => void

interface RegistryHooksLayer {
  readonly keys: readonly (keyof CruxHooks)[]
  readonly previousHooks: Readonly<CruxHooks>
}

export interface CruxProcessRegistry {
  readonly packageName: '@use-crux/core'
  readonly registryVersion: typeof PROCESS_REGISTRY_VERSION
  readonly runtime: {
    currentHooks: CruxHooks
    nextHooksLayerId: number
    hooksLayers: Map<number, RegistryHooksLayer>
    activeInstallation: RuntimeConfigInstallation | undefined
  }
  readonly observability: {
    transport: CruxObservabilityTransport | undefined
    delivery: ObservabilityDeliveryOptions | undefined
    defaultCorrelators: CruxCorrelators | undefined
    nextConfigurationToken: number
    activeConfigurationToken: number
    configurationParents: Map<number, number>
    configurationGeneration: number
    resetGeneration: number
    listeners: Set<WeakRef<ObservabilityRegistryListener>>
  }
}

export function getCruxProcessRegistry(): CruxProcessRegistry {
  const runtime = globalThis as typeof globalThis & Record<symbol, unknown>
  const existing = runtime[PROCESS_REGISTRY_KEY]
  if (isCruxProcessRegistry(existing)) return existing

  if (existing !== undefined) {
    throw new Error(
      'Incompatible @use-crux/core process registry found at the v1 global symbol',
    )
  }

  const registry = createCruxProcessRegistry()
  runtime[PROCESS_REGISTRY_KEY] = registry
  return registry
}

function createCruxProcessRegistry(): CruxProcessRegistry {
  return {
    packageName: '@use-crux/core',
    registryVersion: PROCESS_REGISTRY_VERSION,
    runtime: {
      currentHooks: {},
      nextHooksLayerId: 1,
      hooksLayers: new Map(),
      activeInstallation: undefined,
    },
    observability: {
      transport: undefined,
      delivery: undefined,
      defaultCorrelators: undefined,
      nextConfigurationToken: 0,
      activeConfigurationToken: 0,
      configurationParents: new Map(),
      configurationGeneration: 0,
      resetGeneration: 0,
      listeners: new Set(),
    },
  }
}

function isCruxProcessRegistry(value: unknown): value is CruxProcessRegistry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CruxProcessRegistry>
  const runtime = candidate.runtime as Partial<CruxProcessRegistry['runtime']>
  const observability = candidate.observability as Partial<
    CruxProcessRegistry['observability']
  >
  return (
    candidate.packageName === '@use-crux/core' &&
    candidate.registryVersion === PROCESS_REGISTRY_VERSION &&
    typeof candidate.runtime === 'object' &&
    candidate.runtime !== null &&
    typeof runtime.currentHooks === 'object' &&
    runtime.currentHooks !== null &&
    isRegistryNumber(runtime.nextHooksLayerId) &&
    runtime.hooksLayers instanceof Map &&
    typeof candidate.observability === 'object' &&
    candidate.observability !== null &&
    isRegistryNumber(observability.nextConfigurationToken) &&
    isRegistryNumber(observability.activeConfigurationToken) &&
    observability.configurationParents instanceof Map &&
    isRegistryNumber(observability.configurationGeneration) &&
    isRegistryNumber(observability.resetGeneration) &&
    observability.listeners instanceof Set &&
    [...observability.listeners].every(isObservabilityListenerReference)
  )
}

function isObservabilityListenerReference(
  value: unknown,
): value is WeakRef<ObservabilityRegistryListener> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { deref?: unknown }).deref === 'function'
  )
}

function isRegistryNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

export function addObservabilityRegistryListener(
  registry: CruxProcessRegistry['observability'],
  listener: ObservabilityRegistryListener,
): void {
  registry.listeners.add(new WeakRef(listener))
}

export function notifyObservabilityRegistryListeners(
  registry: CruxProcessRegistry['observability'],
): void {
  for (const reference of registry.listeners) {
    if (!isObservabilityListenerReference(reference)) {
      registry.listeners.delete(reference)
      continue
    }
    try {
      const listener = reference.deref()
      if (listener) listener()
      else registry.listeners.delete(reference)
    } catch {
      registry.listeners.delete(reference)
    }
  }
}
