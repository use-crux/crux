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
  CruxHostBinding,
  DeferLifetimeLimits,
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
  ScopeRetainedTask,
} from "./types";
export { bindRootRetention, enqueueRetainedTask } from "./state";
export { runWithDeferInvocation } from "../defer/host";
export type {
  DeferHandlerSettlement,
  DeferHostBoundaryOptions,
  DeferInvocationOutcome,
} from "../defer/host";
export { onDeferDrainSettled } from "../defer/internal/context";
