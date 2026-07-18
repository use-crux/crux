import {
  runWithCapturedAsyncScope,
  type CapturedAsyncScope,
} from "../async-scope/internal/carrier";
import {
  ScopeSealedError,
  type ExecutionScope,
  type ScopeCloseHook,
  type ScopeCloseOutcome,
  type ScopeWriteOptions,
} from "./contracts";
import { scopeFacetSlotKey, type ScopeFacetSlot } from "./facets";
import { isThenable, sealedReasonFor } from "./lifecycle";
import { createRootPendingTracker, type RootPendingTracker } from "./pending";
import { createRootRetentionGate, type RootRetentionGate } from "./retention";
import type {
  CruxHostBinding,
  ScopeDescriptor,
  ScopeKind,
  ScopePolicies,
  ScopeSealedReason,
  ScopeState,
  ScopeRetainedTask,
} from "./types";

interface RootState {
  readonly pending: RootPendingTracker;
  retention: RootRetentionGate | undefined;
  nextScopeId: number;
}

interface InternalScopeState {
  readonly closeHooks: ScopeCloseHook[];
  readonly facetValues: Map<symbol, unknown>;
  readonly rootState: RootState;
  capturedFrame: CapturedAsyncScope | undefined;
  state: ScopeState;
  sealedReason: ScopeSealedReason | undefined;
}

const scopeStates = new WeakMap<ExecutionScope, InternalScopeState>();

/** Create an immutable public scope backed by closure-owned lifecycle state. */
export function createExecutionScope(
  descriptor: ScopeDescriptor,
  parent: ExecutionScope | undefined,
  policies: ScopePolicies | undefined,
): ExecutionScope {
  const resolvedPolicies = Object.freeze({
    drain: policies?.drain ?? parent?.policies.drain ?? "execute",
    sealedWrites:
      policies?.sealedWrites ?? parent?.policies.sealedWrites ?? "reroute",
    evidence: policies?.evidence ?? "public",
  });
  let scope: ExecutionScope;
  scope = Object.freeze({
    descriptor: Object.freeze(descriptor),
    parent,
    get root(): ExecutionScope {
      return parent?.root ?? scope;
    },
    get state(): ScopeState {
      return stateFor(scope).state;
    },
    get sealedReason(): ScopeSealedReason | undefined {
      return stateFor(scope).sealedReason;
    },
    policies: resolvedPolicies,
    onClose: (hook: ScopeCloseHook, options: ScopeWriteOptions = {}) =>
      registerCloseHook(scope, hook, options),
    trackPending: (operation: PromiseLike<unknown>) =>
      trackRootPending(scope, operation),
    facet: <T>(slot: ScopeFacetSlot<T>) => resolveFacet(scope, slot),
    setFacet: <T>(
      slot: ScopeFacetSlot<T>,
      value: T,
      options: ScopeWriteOptions = {},
    ) => writeFacet(scope, slot, value, options),
    seal: (outcome: ScopeCloseOutcome) => sealScope(scope, outcome),
  });
  scopeStates.set(scope, {
    closeHooks: [],
    facetValues: new Map(),
    rootState: parent
      ? stateFor(parent.root).rootState
      : {
          pending: createRootPendingTracker(),
          retention: undefined,
          nextScopeId: 2,
        },
    capturedFrame: undefined,
    state: "open",
    sealedReason: undefined,
  });
  return scope;
}

/** Associate an execution root with the host binding that retains its pending set. */
export function bindRootRetention(
  scope: ExecutionScope,
  binding: CruxHostBinding,
): void {
  const root = scope.root;
  const rootState = stateFor(root).rootState;
  if (root !== scope) {
    throw new TypeError("Host retention may only bind an execution root.");
  }
  if (rootState.retention) {
    throw new TypeError("The execution root already has a host binding.");
  }
  rootState.retention = createRootRetentionGate(binding, rootState.pending);
}

/** Queue root work whose start is gated on the platform completion moment. */
export function enqueueRetainedTask(
  scope: ExecutionScope,
  task: ScopeRetainedTask,
): void {
  const retention = stateFor(scope.root).rootState.retention;
  if (!retention) {
    throw new TypeError("The execution root has no host retention binding.");
  }
  retention.enqueueTask(task);
}

function trackRootPending(
  scope: ExecutionScope,
  operation: PromiseLike<unknown>,
): void {
  const rootState = stateFor(scope.root).rootState;
  rootState.pending.track(operation);
  rootState.retention?.noteFirstPending();
}

/** Allocate the next generated id from the execution root. */
export function allocateScopeId(
  parent: ExecutionScope,
  kind: ScopeKind,
): string {
  return `${kind}:${stateFor(parent.root).rootState.nextScopeId++}`;
}

/** Attach the carrier frame captured while the scope facet was active. */
export function setScopeCapturedFrame(
  scope: ExecutionScope,
  frame: CapturedAsyncScope,
): void {
  stateFor(scope).capturedFrame = frame;
}

/** Wait for the shared root pending set to drain to empty. */
export function waitForRootIdle(scope: ExecutionScope): Promise<void> {
  return stateFor(scope.root).rootState.pending.whenIdle();
}

/** Resolve the scope on which a write may land under the sealed-write policy. */
export function resolveWritableScope(
  from: ExecutionScope,
  options: ScopeWriteOptions = {},
): ExecutionScope | "sealed" {
  if (acceptsWrite(from, options)) return from;
  if (from.policies.sealedWrites !== "reroute") return "sealed";

  let candidate = from.parent;
  while (candidate) {
    if (acceptsWrite(candidate, options)) return candidate;
    candidate = candidate.parent;
  }
  return "sealed";
}

function stateFor(scope: ExecutionScope): InternalScopeState {
  const state = scopeStates.get(scope);
  if (!state)
    throw new TypeError(
      "Execution scope was not created by the Core scope kernel.",
    );
  return state;
}

function registerCloseHook(
  scope: ExecutionScope,
  hook: ScopeCloseHook,
  options: ScopeWriteOptions,
): void {
  const target = writableTarget(scope, options);
  if (target) stateFor(target).closeHooks.push(hook);
}

function resolveFacet<T>(
  scope: ExecutionScope,
  slot: ScopeFacetSlot<T>,
): T | undefined {
  const key = scopeFacetSlotKey(slot);
  let candidate: ExecutionScope | undefined = scope;
  while (candidate) {
    const values = stateFor(candidate).facetValues;
    if (values.has(key)) return values.get(key) as T;
    candidate = candidate.parent;
  }
  return undefined;
}

function writeFacet<T>(
  scope: ExecutionScope,
  slot: ScopeFacetSlot<T>,
  value: T,
  options: ScopeWriteOptions,
): void {
  const target = writableTarget(scope, options);
  if (target) stateFor(target).facetValues.set(scopeFacetSlotKey(slot), value);
}

function sealScope(scope: ExecutionScope, outcome: ScopeCloseOutcome): void {
  const state = stateFor(scope);
  if (state.state !== "open") return;
  const close = () => closeScope(scope, outcome);
  if (state.capturedFrame) {
    runWithCapturedAsyncScope(state.capturedFrame, close);
    return;
  }
  close();
}

function closeScope(scope: ExecutionScope, outcome: ScopeCloseOutcome): void {
  const state = stateFor(scope);
  if (state.state !== "open") return;
  state.state = "closing";
  let retentionFailure: { readonly error: unknown } | undefined;
  for (let index = 0; index < state.closeHooks.length; index += 1) {
    let operation: void | PromiseLike<void>;
    try {
      operation = state.closeHooks[index]?.(outcome);
    } catch (error) {
      console.error("Crux execution scope close hook failed.", error);
      continue;
    }
    if (!isThenable(operation)) continue;
    try {
      scope.trackPending(operation);
    } catch (error) {
      retentionFailure ??= Object.freeze({ error });
    }
  }
  state.state = "sealed";
  state.sealedReason = sealedReasonFor(outcome);
  if (retentionFailure) throw retentionFailure.error;
}

function writableTarget(
  scope: ExecutionScope,
  options: ScopeWriteOptions,
): ExecutionScope | undefined {
  const target = resolveWritableScope(scope, options);
  if (target !== "sealed") return target;
  if (scope.policies.sealedWrites === "drop") return undefined;
  throw new ScopeSealedError(scope);
}

function acceptsWrite(
  scope: ExecutionScope,
  options: ScopeWriteOptions,
): boolean {
  return (
    scope.state === "open" ||
    (scope.state === "closing" && options.phase === "drain")
  );
}
