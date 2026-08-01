/**
 * Public type grammar for authored request representation ladders.
 *
 * @module
 */

import type { z } from "zod";
import type { Message } from "../../generation/messages";
import type { Context, ContributorEntry } from "../../prompt/context-types";
import type { ToolMiddleware } from "../../tools/types";
import type { SummarizeStrategy } from "../history/strategies";

declare const REPRESENTATION_LADDER: unique symbol;

/** An exact context source that may begin a representation ladder. */
export type RepresentationSource<
  TInput extends z.ZodType = z.ZodType,
> = Context<TInput> | ContributorEntry<TInput>;

/** A handle that can produce an exact context source with default settings. */
export interface RepresentationContextSource<
  TSource extends RepresentationSource = RepresentationSource,
> {
  asContext(): TSource;
}

/** Contexts and first-party handles accepted by representation wrappers. */
export type RepresentationSourceInput<
  TSource extends RepresentationSource = RepresentationSource,
> = TSource | RepresentationContextSource<TSource>;

/** Context type produced after a wrapper normalizes a source input. */
export type NormalizedRepresentationSource<TSource> =
  TSource extends RepresentationSource
    ? TSource
    : TSource extends RepresentationContextSource<infer TContext>
      ? TContext
      : never;

/** Input schema carried by one canonical representation source. */
export type RepresentationSourceSchema<TSource extends RepresentationSource> =
  TSource extends Context<infer TInput>
    ? TInput
    : z.ZodType;

/** Options reserved for generated summary representations. */
export interface SummarizableOptions {
  /** Optional model used for derived-summary support requests. */
  readonly model?: unknown;
  /** Versioned summary strategy. */
  readonly strategy?: SummarizeStrategy;
}

/** Options reserved for exact-recovery reference representations. */
export interface OffloadableOptions {
  /** Prefer a reference only above this estimated token count. */
  readonly aboveTokens?: number;
}

/** Inert exact-recovery policy for a Tool output boundary. */
export interface ToolOutputOffloadPolicy {
  /** Distinguishes Tool output policy from prompt representation ladders. */
  readonly _tag: "offload-output";
  /** Reference selection policy retained for Tool execution. */
  readonly options: Readonly<OffloadableOptions>;
}

/** An ordered ladder of exact authored alternatives. */
export interface PreferLadder<
  TSource extends RepresentationSource = RepresentationSource,
> {
  /** Runtime discriminant used by definition preflight. */
  readonly _tag: "prefer";
  /** Nominal ladder category used to reject illegal nesting. */
  readonly [REPRESENTATION_LADDER]: "prefer";
  /** Canonical source that owns identity, priority, and capabilities. */
  readonly primary: TSource;
  /** Lower-fidelity authored representations in declaration order. */
  readonly alternatives: readonly RepresentationSource<
    RepresentationSourceSchema<TSource>
  >[];
}

/** A ladder that authorizes a generated summary rung. */
export interface SummarizableLadder<
  TSource extends RepresentationSource = RepresentationSource,
> {
  /** Runtime discriminant used by definition preflight. */
  readonly _tag: "summarizable";
  /** Nominal ladder category used to reject illegal nesting. */
  readonly [REPRESENTATION_LADDER]: "summarizable";
  /** Exact source or authored ladder summarized as one atomic unit. */
  readonly source:
    | TSource
    | PreferLadder<TSource>
    | readonly RepresentationSource[];
  /** Summary policy retained until artifact support prepares the rung. */
  readonly options: Readonly<SummarizableOptions>;
}

/** A ladder that authorizes an exact-recovery reference rung. */
export interface OffloadableLadder<
  TSource extends RepresentationSource = RepresentationSource,
> {
  /** Runtime discriminant used by definition preflight. */
  readonly _tag: "offloadable";
  /** Nominal ladder category used to reject illegal nesting. */
  readonly [REPRESENTATION_LADDER]: "offloadable";
  /** Source or non-terminal ladder represented by an exact reference. */
  readonly source:
    | TSource
    | PreferLadder<TSource>
    | SummarizableLadder<TSource>;
  /** Reference policy retained until backing support prepares the rung. */
  readonly options: Readonly<OffloadableOptions>;
}

/** A terminal ladder that authorizes complete omission. */
export interface DroppableLadder<
  TSource extends RepresentationSource = RepresentationSource,
> {
  /** Runtime discriminant used by definition preflight. */
  readonly _tag: "droppable";
  /** Nominal ladder category used to reject illegal nesting. */
  readonly [REPRESENTATION_LADDER]: "droppable";
  /** Source or non-terminal ladder that may be omitted. */
  readonly source:
    | TSource
    | PreferLadder<TSource>
    | SummarizableLadder<TSource>
    | OffloadableLadder<TSource>;
}

/** A value that must be lowered to an exact-recovery reference. */
export interface ForcedOffload<T> {
  /** Runtime discriminant used by request preflight. */
  readonly _tag: "offload";
  /** Canonical value retained outside the model-facing representation. */
  readonly value: T;
}

/** Any representation ladder accepted in a prompt `use` array. */
export type RepresentationLadder =
  | PreferLadder
  | SummarizableLadder
  | OffloadableLadder
  | DroppableLadder;

/** Any representation-policy entry accepted by prompt composition. */
export type RepresentationEntry =
  | RepresentationLadder
  | ForcedOffload<unknown>;

/** One resolved rung ready for complete-request candidate construction. @internal */
export interface ResolvedRepresentationRung {
  readonly kind:
    | "full"
    | "authored"
    | "summary"
    | "offload"
    | "omitted";
  readonly text?: string;
  /** Complete canonical transcript for a history representation. */
  readonly messages?: readonly Message[];
  readonly available: boolean;
  /** Linked support request that prepared this representation. */
  readonly supportRequestId?: string;
  /** Every bounded support request that prepared this representation. */
  readonly supportRequestIds?: readonly string[];
  /** Publish exact backing before this rung can be dispatched. */
  readonly publish?: () => Promise<void>;
  /** Revalidate the pinned backing revision before dispatch. */
  readonly validate?: () => Promise<void>;
}

/** Resolved redacted policy carried from prompt resolution into planning. @internal */
export interface ResolvedRepresentationPolicy {
  readonly contributor: string;
  readonly sources: readonly string[];
  readonly fullTexts: readonly string[];
  readonly priority: number;
  readonly declarationOrder: number;
  readonly ownedToolNames: readonly string[];
  readonly ownedPolicyIds: readonly string[];
  readonly ownedSkillIds: readonly string[];
  readonly ownedToolMiddleware: readonly ToolMiddleware[];
  /** Required support Tools retained only by selected offload rungs. */
  readonly supportToolNames?: readonly string[];
  readonly skillProjection?: {
    readonly source: string;
    readonly fullText: string;
    readonly allSkillIds: readonly string[];
    readonly loaderToolNames: readonly string[];
    readonly renderRetained: (retainedSkillIds: readonly string[]) => string;
  };
  readonly omissionEdits: readonly {
    readonly source: string;
    readonly fullText: string;
    readonly replacement: string;
  }[];
  /** Lowest safe transcript used only for branch lower-bound measurement. */
  readonly lowerBoundMessages?: readonly Message[];
  /** Canonical derived-summary policy retained for request-time preparation. */
  readonly summary?: {
    readonly sourceTexts: readonly string[];
    /** Content-free source revision digests included in derived artifact identity. */
    readonly sourceDigests?: readonly string[];
    readonly model?: unknown;
    readonly strategy: SummarizeStrategy;
  };
  /** Canonical exact-recovery source retained until request planning. */
  readonly offload?: {
    readonly value: unknown;
    readonly options: Readonly<OffloadableOptions>;
    readonly forced: boolean;
  };
  readonly rungs: readonly ResolvedRepresentationRung[];
}

/** Legal input to {@link summarizable}. */
export type SummarizableInput<
  TSource extends RepresentationSourceInput,
> =
  | TSource
  | PreferLadder<NormalizedRepresentationSource<TSource>>
  | readonly RepresentationSourceInput[];

/** Legal input to {@link offloadable}. */
export type OffloadableInput<
  TSource extends RepresentationSourceInput,
> =
  | TSource
  | PreferLadder<NormalizedRepresentationSource<TSource>>
  | SummarizableLadder<NormalizedRepresentationSource<TSource>>;

/** Legal input to {@link droppable}. */
export type DroppableInput<
  TSource extends RepresentationSourceInput,
> =
  | TSource
  | PreferLadder<NormalizedRepresentationSource<TSource>>
  | SummarizableLadder<NormalizedRepresentationSource<TSource>>
  | OffloadableLadder<NormalizedRepresentationSource<TSource>>;
