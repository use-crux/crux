import type {
  CruxObservabilityTransport,
  ObservabilityDeliveryOptions,
} from "../observability";
import type { CruxFeedbackDestination } from "../feedback";
import type { CruxCorrelators } from "../observability/correlators";
import type { CruxDeploymentIdentity } from "../project-index";
import type { RuntimeConfigInstallation } from "./config-transaction";
import type { CruxHooks } from "./runtime";
import type {
  ActivePromptCatalogue,
  PromptCatalogueListener,
} from "./prompt-catalogue-state";
import { isActivePromptCatalogue } from "./prompt-catalogue-state";
const PROCESS_REGISTRY_VERSION = 3;
const PROCESS_REGISTRY_KEY = Symbol.for("@use-crux/core/process-registry/v3");

export type ObservabilityRegistryListener = () => void;

interface RegistryHooksLayer {
  readonly keys: readonly (keyof CruxHooks)[];
  readonly previousHooks: Readonly<CruxHooks>;
}

const CRUX_HOOK_KEYS = new Set<keyof CruxHooks>([
  "middleware",
  "resolveHook",
  "executionHook",
  "streamProgressHook",
  "streamStartHook",
  "observabilityTransport",
  "projectIndexRuntimeTransport",
  "observabilityDelivery",
  "observabilityCapture",
  "spanActivationHook",
  "telemetryFlushHook",
  "telemetryResumeAttributesHook",
  "records",
  "assets",
  "runtimeEngine",
  "hostBinding",
  "globalConstraints",
  "globalGuardrails",
  "semanticCacheInstalled",
]);

export interface CruxProcessRegistry {
  readonly packageName: "@use-crux/core";
  readonly registryVersion: typeof PROCESS_REGISTRY_VERSION;
  readonly runtime: {
    currentHooks: CruxHooks;
    nextHooksLayerId: number;
    hooksLayers: Map<number, RegistryHooksLayer>;
    activeInstallation: RuntimeConfigInstallation | undefined;
  };
  readonly promptCatalogue: {
    nextOwnerToken: number;
    activeOwnerToken: number;
    current: ActivePromptCatalogue;
    listeners: Set<PromptCatalogueListener>;
  };
  readonly observability: {
    transport: CruxObservabilityTransport | undefined;
    delivery: ObservabilityDeliveryOptions | undefined;
    defaultCorrelators: CruxCorrelators | undefined;
    deploymentIdentity: CruxDeploymentIdentity | undefined;
    feedbackDestination: CruxFeedbackDestination | undefined;
    redactPaths: readonly string[];
    nextConfigurationToken: number;
    activeConfigurationToken: number;
    configurationParents: Map<number, number>;
    configurationGeneration: number;
    resetGeneration: number;
    listeners: Set<WeakRef<ObservabilityRegistryListener>>;
  };
}

export function getCruxProcessRegistry(): CruxProcessRegistry {
  const runtime = globalThis as typeof globalThis & Record<symbol, unknown>;
  const existing = runtime[PROCESS_REGISTRY_KEY];
  if (isCruxProcessRegistry(existing)) return existing;

  if (existing !== undefined) {
    throw new Error(
      "Incompatible @use-crux/core process registry found at the v3 global symbol",
    );
  }

  const registry = createCruxProcessRegistry();
  runtime[PROCESS_REGISTRY_KEY] = registry;
  return registry;
}

function createCruxProcessRegistry(): CruxProcessRegistry {
  return {
    packageName: "@use-crux/core",
    registryVersion: PROCESS_REGISTRY_VERSION,
    runtime: {
      currentHooks: {},
      nextHooksLayerId: 1,
      hooksLayers: new Map(),
      activeInstallation: undefined,
    },
    promptCatalogue: {
      nextOwnerToken: 0,
      activeOwnerToken: 0,
      current: Object.freeze({
        revision: 0,
        entries: Object.freeze([]),
      }),
      listeners: new Set(),
    },
    observability: {
      transport: undefined,
      delivery: undefined,
      defaultCorrelators: undefined,
      deploymentIdentity: undefined,
      feedbackDestination: undefined,
      redactPaths: Object.freeze([]),
      nextConfigurationToken: 0,
      activeConfigurationToken: 0,
      configurationParents: new Map(),
      configurationGeneration: 0,
      resetGeneration: 0,
      listeners: new Set(),
    },
  };
}

function isCruxProcessRegistry(value: unknown): value is CruxProcessRegistry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CruxProcessRegistry>;
  const runtime = candidate.runtime as Partial<CruxProcessRegistry["runtime"]>;
  const observability = candidate.observability as Partial<
    CruxProcessRegistry["observability"]
  >;
  const promptCatalogue = candidate.promptCatalogue as Partial<
    CruxProcessRegistry["promptCatalogue"]
  >;
  return (
    candidate.packageName === "@use-crux/core" &&
    candidate.registryVersion === PROCESS_REGISTRY_VERSION &&
    typeof candidate.runtime === "object" &&
    candidate.runtime !== null &&
    typeof runtime.currentHooks === "object" &&
    runtime.currentHooks !== null &&
    isRegistryNumber(runtime.nextHooksLayerId) &&
    runtime.nextHooksLayerId > 0 &&
    isRegistryHooksLayers(runtime.hooksLayers, runtime.nextHooksLayerId) &&
    typeof candidate.promptCatalogue === "object" &&
    candidate.promptCatalogue !== null &&
    isRegistryNumber(promptCatalogue.nextOwnerToken) &&
    isRegistryNumber(promptCatalogue.activeOwnerToken) &&
    promptCatalogue.activeOwnerToken! <= promptCatalogue.nextOwnerToken! &&
    isActivePromptCatalogue(promptCatalogue.current) &&
    promptCatalogue.listeners instanceof Set &&
    [...promptCatalogue.listeners].every(
      (listener) => typeof listener === "function",
    ) &&
    typeof candidate.observability === "object" &&
    candidate.observability !== null &&
    isRegistryNumber(observability.nextConfigurationToken) &&
    isRegistryNumber(observability.activeConfigurationToken) &&
    isConfigurationParents(
      observability.configurationParents,
      observability.nextConfigurationToken,
      observability.activeConfigurationToken,
    ) &&
    isRegistryNumber(observability.configurationGeneration) &&
    isRegistryNumber(observability.resetGeneration) &&
    (observability.feedbackDestination === undefined ||
      (typeof observability.feedbackDestination === "object" &&
        observability.feedbackDestination !== null &&
        typeof observability.feedbackDestination.submitFeedback ===
          "function")) &&
    Array.isArray(observability.redactPaths) &&
    observability.redactPaths.every((path) => typeof path === "string") &&
    observability.listeners instanceof Set &&
    [...observability.listeners].every(isObservabilityListenerReference)
  );
}

function isRegistryHooksLayers(
  value: unknown,
  nextLayerId: number,
): value is Map<number, RegistryHooksLayer> {
  if (!(value instanceof Map)) return false;
  for (const [id, layer] of value) {
    if (
      !isRegistryNumber(id) ||
      id === 0 ||
      id >= nextLayerId ||
      !isRegistryHooksLayer(layer)
    ) {
      return false;
    }
  }
  return true;
}

function isRegistryHooksLayer(value: unknown): value is RegistryHooksLayer {
  if (typeof value !== "object" || value === null) return false;
  const layer = value as { keys?: unknown; previousHooks?: unknown };
  return (
    Array.isArray(layer.keys) &&
    layer.keys.every(isCruxHookKey) &&
    isCruxHooksShape(layer.previousHooks)
  );
}

function isCruxHooksShape(value: unknown): value is Readonly<CruxHooks> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).every(isCruxHookKey)
  );
}

function isCruxHookKey(value: unknown): value is keyof CruxHooks {
  return (
    typeof value === "string" && CRUX_HOOK_KEYS.has(value as keyof CruxHooks)
  );
}

function isConfigurationParents(
  value: unknown,
  nextToken: number,
  activeToken: number,
): value is Map<number, number> {
  if (!(value instanceof Map)) return false;
  for (const [token, parentToken] of value) {
    if (
      !isRegistryNumber(token) ||
      token === 0 ||
      token > nextToken ||
      !isRegistryNumber(parentToken) ||
      parentToken > nextToken
    ) {
      return false;
    }
  }

  const parents = value as Map<number, number>;
  if (activeToken !== 0 && !parents.has(activeToken)) return false;
  for (const parentToken of parents.values()) {
    if (parentToken !== 0 && !parents.has(parentToken)) return false;
  }
  for (const token of parents.keys()) {
    const visited = new Set<number>();
    let currentToken = token;
    while (currentToken !== 0) {
      if (visited.has(currentToken)) return false;
      visited.add(currentToken);
      const parentToken = parents.get(currentToken);
      if (parentToken === undefined) return false;
      currentToken = parentToken;
    }
  }
  return true;
}

function isObservabilityListenerReference(
  value: unknown,
): value is WeakRef<ObservabilityRegistryListener> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { deref?: unknown }).deref === "function"
  );
}

function isRegistryNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function addObservabilityRegistryListener(
  registry: CruxProcessRegistry["observability"],
  listener: ObservabilityRegistryListener,
): void {
  registry.listeners.add(new WeakRef(listener));
}

export function notifyObservabilityRegistryListeners(
  registry: CruxProcessRegistry["observability"],
): void {
  for (const reference of registry.listeners) {
    if (!isObservabilityListenerReference(reference)) {
      registry.listeners.delete(reference);
      continue;
    }
    try {
      const listener = reference.deref();
      if (listener) listener();
      else registry.listeners.delete(reference);
    } catch {
      registry.listeners.delete(reference);
    }
  }
}
