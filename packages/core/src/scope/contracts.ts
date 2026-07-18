import type { ScopeFacetSlot } from "./facets";
import type {
  ScopeDescriptor,
  ScopeDrainPolicy,
  ScopeEvidencePolicy,
  ScopeOutcome,
  ScopePolicies,
  ScopeSealedReason,
  ScopeSealedWritePolicy,
  ScopeState,
} from "./types";

/** What close hooks receive, including out-of-band timeout sealing. */
export type ScopeCloseOutcome = ScopeOutcome | "timeout";
export type ScopeCloseHook = (
  outcome: ScopeCloseOutcome,
) => void | PromiseLike<void>;

/** Metadata carried by writes that occur during close-hook draining. */
export interface ScopeWriteOptions {
  readonly phase?: "handler" | "drain";
}

/** Internal execution boundary shared by Core subsystems and first-party packages. */
export interface ExecutionScope {
  readonly descriptor: ScopeDescriptor;
  readonly parent: ExecutionScope | undefined;
  readonly root: ExecutionScope;
  readonly state: ScopeState;
  readonly sealedReason: ScopeSealedReason | undefined;
  readonly policies: {
    readonly drain: ScopeDrainPolicy;
    readonly sealedWrites: ScopeSealedWritePolicy;
    readonly evidence: ScopeEvidencePolicy;
  };

  onClose(hook: ScopeCloseHook, options?: ScopeWriteOptions): void;
  trackPending(operation: PromiseLike<unknown>): void;
  facet<T>(slot: ScopeFacetSlot<T>): T | undefined;
  setFacet<T>(
    slot: ScopeFacetSlot<T>,
    value: T,
    options?: ScopeWriteOptions,
  ): void;
  seal(outcome: ScopeCloseOutcome): void;
}

/** Options controlling policy inheritance and settlement classification. */
export interface RunScopeOptions {
  readonly policies?: ScopePolicies;
  readonly classifyOutcome?: (
    settlement: { kind: "returned" } | { kind: "thrown"; error: unknown },
  ) => ScopeOutcome;
}

/** Controller for execution whose lifetime spans multiple restored segments. */
export interface ScopeController {
  readonly scope: ExecutionScope;
  run<T>(segment: () => T | PromiseLike<T>): T | PromiseLike<T>;
  seal(outcome: ScopeCloseOutcome): void;
}

/** Raised when a write cannot land according to a scope's sealed-write policy. */
export class ScopeSealedError extends Error {
  readonly scope: ScopeDescriptor;

  constructor(scope: ExecutionScope) {
    super(`Execution scope \`${scope.descriptor.id}\` is sealed.`);
    this.name = "ScopeSealedError";
    this.scope = scope.descriptor;
  }
}
