/**
 * First-party execution-scope SPI.
 *
 * This entrypoint coordinates Core subsystems and official integration
 * packages. It is not an application-facing context API.
 *
 * @internal
 * @module
 */

export {
  ScopeSealedError,
  currentScope,
  currentScopeFacet,
  currentScopeStack,
  openScope,
  resolveConfiguredHost,
  resolveWritableScope,
  runScope,
  runWithScopeFacet,
  whenRootIdle,
  type ExecutionScope,
  type RunScopeOptions,
  type ScopeCloseHook,
  type ScopeCloseOutcome,
  type ScopeController,
  type ScopeWriteOptions,
} from "./kernel";
export {
  createScopeFacetSlot,
  registeredScopeFacetSlotsForTesting,
  type ScopeFacetSlot,
} from "./facets";
export type {
  ScopeDescriptor,
  ScopeDrainPolicy,
  ScopeEvidencePolicy,
  ScopeKind,
  ScopeOutcome,
  ScopePolicies,
  ScopeSealedReason,
  ScopeSealedWritePolicy,
  ScopeSourceRef,
  ScopeState,
} from "./types";
export { runWithDeferInvocation } from "../defer/host";
export type {
  DeferCompletionClass,
  DeferHandlerSettlement,
  DeferHostBoundaryOptions,
  DeferInvocationOutcome,
  DeferLifetimeCapability,
  DeferLifetimeLimits,
  DeferScheduledTask,
} from "../defer/host";
export {
  createHandlerReturnedDeferLifetime,
  createResponseFinishedDeferLifetime,
} from "../defer/lifecycle";
export type {
  HandlerReturnedLifetimeOptions,
  ResponseFinishedLifetimeOptions,
  ResponseFinishedTerminal,
} from "../defer/lifecycle";
