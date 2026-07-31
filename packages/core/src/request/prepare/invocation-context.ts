/**
 * Typed immutable contexts for composition-boundary preparation.
 *
 * @module
 */

import type { AnyModel } from "../../types";
import type {
  ExecutionAmendment,
  OperationKind,
} from "./amendment";
import type { PreparationResources } from "./resources";
import type { PreparationScopeStats } from "./step-context";

/** A concrete managed child selected by a composition. */
export interface InvocationTarget<
  TOperation extends OperationKind = "language",
> {
  /** Stable child definition identity. */
  readonly id: string;
  /** Managed operation performed by this child. */
  readonly operation: TOperation;
}

/** Minimal statistics captured before one child invocation. */
export interface InvocationPreparationStats {
  /** Time at which Core captured this immutable snapshot. */
  readonly at: Date;
  /** Execution-local activity cursor. */
  readonly cursor: number;
  /** Completed child facts for this composition activation. */
  readonly run: PreparationScopeStats;
  /** Completed child facts for the outer activity root. */
  readonly root: PreparationScopeStats;
}

interface BaseInvocationContext {
  readonly operation: "language";
  readonly target: InvocationTarget<"language">;
  readonly composition: {
    readonly id: string;
    readonly kind: "pipeline" | "parallel" | "consensus" | "swarm";
  };
  readonly stats: InvocationPreparationStats;
  readonly resources: PreparationResources;
  readonly signal: AbortSignal;
}

/** Context supplied before one managed Pipeline stage. */
export interface PipelineInvocationContext extends BaseInvocationContext {
  readonly composition: {
    readonly id: string;
    readonly kind: "pipeline";
  };
  /** Selected stage identity. */
  readonly step: {
    readonly name: string;
    readonly index: number;
  };
  /** Immutable accumulated Pipeline context before the stage. */
  readonly context: Readonly<Record<string, unknown>>;
}

/** Context supplied before one managed Parallel branch. */
export interface ParallelInvocationContext extends BaseInvocationContext {
  readonly composition: {
    readonly id: string;
    readonly kind: "parallel";
  };
  /** Selected branch identity. */
  readonly branch: {
    readonly name: string;
    readonly index: number;
  };
  /** Immutable shared branch input. */
  readonly context: unknown;
}

/** Context supplied before one managed Consensus candidate. */
export interface ConsensusInvocationContext extends BaseInvocationContext {
  readonly composition: {
    readonly id: string;
    readonly kind: "consensus";
  };
  /** Selected candidate identity. */
  readonly candidate: {
    readonly index: number;
  };
  /** Immutable candidate input. */
  readonly input: unknown;
}

/** Context supplied before one managed Swarm turn. */
export interface SwarmInvocationContext extends BaseInvocationContext {
  readonly composition: {
    readonly id: string;
    readonly kind: "swarm";
  };
  /** Selected turn and handoff facts. */
  readonly hop: {
    readonly index: number;
    readonly path: readonly string[];
    readonly fromAgent?: string;
    readonly reason?: string;
  };
  /** Immutable input passed to the selected Agent. */
  readonly input: unknown;
}

/** Composition-specific contexts accepted by {@link PrepareInvocation}. */
export type InvocationContext =
  | PipelineInvocationContext
  | ParallelInvocationContext
  | ConsensusInvocationContext
  | SwarmInvocationContext;

/**
 * Callback evaluated once before a composition invokes one managed leaf.
 *
 * The returned amendment becomes the child invocation baseline. Function-only
 * stages and nested composition wrappers never invoke this callback.
 */
export type PrepareInvocation<
  TModel = AnyModel,
  TContext extends InvocationContext = InvocationContext,
> = (
  context: TContext,
) =>
  | ExecutionAmendment<TModel, "language">
  | undefined
  | Promise<ExecutionAmendment<TModel, "language"> | undefined>;

/** Composition-owned fields used to build one typed callback context. @internal */
export type InvocationContextSeed =
  | {
      readonly composition: PipelineInvocationContext["composition"];
      readonly step: PipelineInvocationContext["step"];
      readonly context: PipelineInvocationContext["context"];
    }
  | {
      readonly composition: ParallelInvocationContext["composition"];
      readonly branch: ParallelInvocationContext["branch"];
      readonly context: ParallelInvocationContext["context"];
    }
  | {
      readonly composition: ConsensusInvocationContext["composition"];
      readonly candidate: ConsensusInvocationContext["candidate"];
      readonly input: ConsensusInvocationContext["input"];
    }
  | {
      readonly composition: SwarmInvocationContext["composition"];
      readonly hop: SwarmInvocationContext["hop"];
      readonly input: SwarmInvocationContext["input"];
    };
