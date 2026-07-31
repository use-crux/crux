/**
 * Public connected knowledge view handle types.
 *
 * @module
 */

import type { z } from 'zod'
import type { Grounding } from '../../citations'
import type { EmbeddingModality } from '../../embedding'
import type { ExactFilter } from '../../storage'
import type { RetrievalRecipe, RetrievalRecipeConfig, RetrievalRecipeGroundingConfig } from '../../retrieval/recipe/recipe'
import type { retrieve } from '../../retrieval/recipe/steps/built-ins'
import type { RetrievalStep } from '../../retrieval/recipe/step'
import type { RetrievalToolConfig, Retriever, RetrieverTools } from '../../retrieval/types'
import type { KnowledgeBaseFilter, KnowledgeBaseGroundingConfig, KnowledgeBaseRetrieverConfig } from '../../retrieval/knowledge-base'
import type { AssertionStage } from '../assertions/assertions'
import type { AssertionSet, AssertionSetOptions } from '../assertions/set'
import type { KnowledgeCommunitiesSurface } from '../communities/lifecycle'
import type { NormalizedViewWhere, ViewWhere } from './where'

/** Configuration accepted by {@link KnowledgeView.retriever}. */
export type KnowledgeViewRetrieverConfig<TFilter extends ExactFilter = ExactFilter> = KnowledgeBaseRetrieverConfig<TFilter>

/** Options for {@link KnowledgeView.recipe}. */
export type KnowledgeViewRecipeConfig<TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]> = Omit<
  RetrievalRecipeConfig<TSteps>,
  'id' | 'retriever'
> & {
  /** Stable recipe id. Anonymous bound recipes derive one from read surface and behavior. */
  readonly id?: string
}

/** Configuration passed to {@link KnowledgeBase.view}. */
export interface KnowledgeBaseViewConfig<TMetadataSchema extends z.ZodType<unknown> | undefined> {
  /** Stable id for the view within this knowledge-base namespace. */
  readonly id: string
  /** Exact metadata predicate selecting source membership. */
  readonly where: TMetadataSchema extends z.ZodObject<z.ZodRawShape> ? ViewWhere<z.infer<TMetadataSchema>> : never
}

/** Result returned by {@link KnowledgeView.resolve}. */
export interface KnowledgeViewResolution {
  /** Content-addressed revision hash for the resolved member set. */
  readonly revisionHash: string
  /** Source ids visible in this revision. */
  readonly members: readonly string[]
}

/** Inspectable metadata for a connected knowledge view handle. */
export interface KnowledgeViewInspection {
  /** Stable view id. */
  readonly id: string
  /** Structural namespace bound to this handle. */
  readonly namespace: string
  /** Canonical normalized predicate used by membership indexes. */
  readonly where: NormalizedViewWhere
  /** Revision hash after this handle has resolved membership. */
  readonly revisionHash?: string
}

/** Pinned or live read surface over a metadata-selected source set. */
export interface KnowledgeView<
  TMetadataSchema extends z.ZodType<unknown> | undefined = undefined,
  TModality extends EmbeddingModality = 'text',
> {
  /** Stable view id. */
  readonly id: string
  /** Structural namespace bound to this handle. */
  readonly namespace: string
  /** Resolve the visible source set and revision hash. */
  resolve(): Promise<KnowledgeViewResolution>
  /** Return a handle pinned to a persisted revision. */
  at(revisionHash: string): KnowledgeView<TMetadataSchema, TModality>
  /** Return this view as a revision-scoped retriever. */
  retriever(config?: KnowledgeViewRetrieverConfig<KnowledgeBaseFilter<TMetadataSchema>>): Retriever<KnowledgeBaseFilter<TMetadataSchema>, TModality>
  /** Return this view as a retrieval recipe. */
  recipe<const TSteps extends readonly RetrievalStep[] = readonly [ReturnType<typeof retrieve>]>(
    config?: KnowledgeViewRecipeConfig<TSteps>,
  ): RetrievalRecipe
  /** Return this view as grounded prompt context/tools. */
  grounding(config?: KnowledgeBaseGroundingConfig | RetrievalRecipeGroundingConfig): Grounding
  /** Return this view as retrieval tools. */
  tools<const TConfig extends RetrievalToolConfig | undefined = undefined>(config?: TConfig): RetrieverTools<TConfig>
  /** Return a lazy view-bound set of persisted assertions. */
  assertions<
    const TTypes extends Record<string, z.ZodType<unknown>>,
    const TSelected extends keyof TTypes & string = keyof TTypes & string,
  >(stage: AssertionStage<TTypes>, options?: AssertionSetOptions<TTypes, TSelected>): AssertionSet<TTypes, TSelected>
  /** Connected knowledge community lifecycle and reports, when configured. */
  readonly communities?: KnowledgeCommunitiesSurface
  /** Inspect this view handle without forcing a resolve. */
  inspect(): KnowledgeViewInspection
}
