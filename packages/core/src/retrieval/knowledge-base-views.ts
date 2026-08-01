/**
 * Connected knowledge view facade wiring for knowledge bases.
 *
 * @module
 */

import { z } from 'zod'
import { grounding } from '../citations'
import type { Grounding } from '../citations'
import type { EmbeddingModality } from '../embedding'
import { loadViewRevision, type ViewRevision } from '../knowledge/view/revision'
import { createAssertionSet } from '../knowledge/assertions/set'
import type { CommunitiesConfig } from '../knowledge/communities/communities'
import type { KnowledgeViewRegistry, ViewRegistration } from '../knowledge/view/registry'
import type { KnowledgeBaseViewConfig, KnowledgeView, KnowledgeViewRecipeConfig, KnowledgeViewResolution, KnowledgeViewRetrieverConfig } from '../knowledge/view/view'
import { normalizeViewWhere, type NormalizedViewWhere } from '../knowledge/view/where'
import type { AssetStore, ExactFilter, RecordStore } from '../storage'
import type { KnowledgeBaseFilter, KnowledgeBaseGroundingConfig } from './knowledge-base'
import { createViewRetriever } from './knowledge-base-view-retriever'
import type { RetrievalKnowledgeBinding } from './recipe/knowledge-binding'
import { createRecipeCommunitiesBinding, globalSearchRecipeRetriever } from './recipe/communities-binding'
import { retrievalRecipe, type RetrievalRecipe } from './recipe/recipe'
import { retrieve } from './recipe/steps/built-ins'
import type { RetrievalStep } from './recipe/step'
import { deriveBoundRetrievalRecipeIdentity, viewRecipeSurface } from './recipe/bound-identity'
import type { Retriever, RetrievalToolConfig, RetrieverTools } from './types'
import {
  injectKnowledgeRetrievalContext,
  knowledgeRetrievalContext,
  type KnowledgeRetrievalContextOptions,
} from './knowledge-base-context'
import type { Context } from '../prompt/context-types'
import type { InternalPromptInjection } from '../prompt/internal-injection'

interface KnowledgeBaseViewFactoryConfig<
  TMetadataSchema extends z.ZodType<unknown> | undefined,
  TModality extends EmbeddingModality,
> {
  readonly id: string
  readonly namespace: string
  readonly metadataSchema?: TMetadataSchema
  readonly view: KnowledgeBaseViewConfig<TMetadataSchema>
  readonly records?: RecordStore
  readonly assets?: AssetStore
  readonly registry: KnowledgeViewRegistry
  readonly retriever: <TFilter extends ExactFilter>(config?: KnowledgeViewRetrieverConfig<TFilter>) => Retriever<TFilter, TModality>
  readonly knowledgeBinding: () => RetrievalKnowledgeBinding | undefined
  readonly communities?: CommunitiesConfig
  readonly retention?: 'cleanup' | 'retain-inactive'
  readonly pinnedRevisionHash?: string
}

/** Create a public connected-knowledge view handle. Internal. */
export function createKnowledgeBaseView<
  const TMetadataSchema extends z.ZodType<unknown> | undefined,
  const TModality extends EmbeddingModality,
>(config: KnowledgeBaseViewFactoryConfig<TMetadataSchema, TModality>): KnowledgeView<TMetadataSchema, TModality> {
  const schema = requireObjectMetadataSchema(config.id, config.metadataSchema)
  const where = normalizeViewWhere(config.view.where, schema)
  const registration = { viewId: config.view.id, where }
  config.registry.register(registration)
  return createViewHandle(config, registration)
}

function createViewHandle<
  const TMetadataSchema extends z.ZodType<unknown> | undefined,
  const TModality extends EmbeddingModality,
>(
  config: KnowledgeBaseViewFactoryConfig<TMetadataSchema, TModality>,
  registration: ViewRegistration,
): KnowledgeView<TMetadataSchema, TModality> {
  let resolved: ViewRevision | undefined

  async function revision(): Promise<ViewRevision> {
    if (config.pinnedRevisionHash) {
      if (resolved) return resolved
      if (!config.records) throw new Error(`knowledgeBase().view("${registration.viewId}") requires record storage.`)
      const stored = await loadViewRevision({
        records: config.records,
        indexerId: config.id,
        namespace: config.namespace,
        viewId: registration.viewId,
        revisionHash: config.pinnedRevisionHash,
      })
      if (!stored) {
        throw new Error(`View "${registration.viewId}" revision "${config.pinnedRevisionHash}" does not exist in namespace "${config.namespace}".`)
      }
      await config.registry.assertRevisionAvailable(registration.viewId, stored)
      resolved = stored
      return stored
    }
    resolved = await config.registry.resolveCurrent(registration)
    return resolved
  }

  async function resolve(): Promise<KnowledgeViewResolution> {
    const current = await revision()
    return {
      revisionHash: current.revisionHash,
      members: current.members.map((member) => member.sourceId),
    }
  }

  function memberBinding(): RetrievalKnowledgeBinding | undefined {
    const binding = config.knowledgeBinding()
    if (!binding) return undefined
    return {
      ...binding,
      hydrate: async (ref) => {
        const hit = await binding.hydrate(ref)
        if (!hit || hit.kind === 'finding') return null
        return (await memberSet()).has(hit.source.id) ? hit : null
      },
    }
  }

  async function availableRevision(): Promise<ViewRevision> {
    const current = await revision()
    await config.registry.assertRevisionAvailable(registration.viewId, current)
    return current
  }

  async function memberSet(): Promise<ReadonlySet<string>> {
    return new Set((await availableRevision()).members.map((member) => member.sourceId))
  }

  const communities = createRecipeCommunitiesBinding({
    records: config.records,
    ...(config.assets ? { assets: config.assets } : {}),
    indexerId: config.id,
    namespace: config.namespace,
    config: config.communities,
    viewId: registration.viewId,
    resolveView: availableRevision,
    retention: config.retention,
  })

  const handle: KnowledgeView<TMetadataSchema, TModality> = {
    _tag: 'KnowledgeView',
    id: registration.viewId,
    namespace: config.namespace,
    resolve,
    at: (revisionHash) =>
      createViewHandle({ ...config, pinnedRevisionHash: revisionHash }, registration),
    retriever: (retrieverConfig) =>
      createViewRetriever({
        id: `${config.id}:${registration.viewId}`,
        indexerId: config.id,
        namespace: config.namespace,
        where: registration.where,
        base: config.retriever(retrieverConfig as KnowledgeViewRetrieverConfig<ExactFilter> | undefined),
        records: config.records,
        resolveRevision: availableRevision,
        assertRevisionAvailable: (current) => config.registry.assertRevisionAvailable(registration.viewId, current),
        defaultLimit: retrieverConfig?.limit,
        defaultFilter: retrieverConfig?.filter as ExactFilter | undefined,
      }) as Retriever<KnowledgeBaseFilter<TMetadataSchema>, TModality>,
    recipe: <const TSteps extends readonly RetrievalStep[] = readonly RetrievalStep[]>(
      recipeConfig?: KnowledgeViewRecipeConfig<TSteps>,
    ): RetrievalRecipe => {
      const usesGlobalSearch = recipeConfig?.steps.some((step) => step.kind === 'global-search') ?? false
      const viewRetriever = usesGlobalSearch
        ? globalSearchRecipeRetriever(`${config.id}:${registration.viewId}`, config.namespace)
        : handle.retriever() as unknown as Retriever
      const knowledge = memberBinding()
      const surface = viewRecipeSurface({ knowledgeBaseId: config.id, namespace: config.namespace, viewId: registration.viewId, where: registration.where, ...(config.pinnedRevisionHash ? { revisionHash: config.pinnedRevisionHash } : {}) })
      if (!recipeConfig) {
        const steps = [retrieve()] as const
        const identity = deriveBoundRetrievalRecipeIdentity({
          surface,
          steps,
        })
        const defaultRecipeConfig = {
          id: identity.id,
          fingerprint: identity.fingerprint,
          retriever: viewRetriever,
          steps,
          ...(knowledge ? { knowledge } : {}),
          ...(communities.binding ? { communities: communities.binding } : {}),
        }
        return retrievalRecipe(defaultRecipeConfig)
      }
      const identity = recipeConfig.id !== undefined
        ? { id: recipeConfig.id, fingerprint: undefined }
        : deriveBoundRetrievalRecipeIdentity({
            surface,
            steps: recipeConfig.steps,
            ...(recipeConfig.model ? { model: recipeConfig.model } : {}),
            ...(recipeConfig.concurrency !== undefined ? { concurrency: recipeConfig.concurrency } : {}),
            ...(recipeConfig.onSourceError !== undefined ? { onSourceError: recipeConfig.onSourceError } : {}),
          })
      return retrievalRecipe({
        ...recipeConfig,
        id: identity.id,
        ...(identity.fingerprint ? { fingerprint: identity.fingerprint } : {}),
        retriever: viewRetriever,
        ...(knowledge ? { knowledge } : {}),
        ...(communities.binding ? { communities: communities.binding } : {}),
      })
    },
    grounding: (groundingConfig?: KnowledgeBaseGroundingConfig): Grounding =>
      grounding({
        ...(groundingConfig ?? {}),
        id: groundingConfig?.id ?? `grounding:${config.id}:${registration.viewId}`,
        retriever: handle.retriever() as unknown as Retriever,
      }),
    asContext: (options?: KnowledgeRetrievalContextOptions): Context<z.ZodType<{}>> =>
      knowledgeRetrievalContext(handle.retriever({ limit: options?.limit }) as unknown as Retriever, options),
    inject: async (_args: { input: Record<string, unknown>; promptId?: string }): Promise<InternalPromptInjection> =>
      injectKnowledgeRetrievalContext(handle.retriever() as unknown as Retriever),
    tools: <const TConfig extends RetrievalToolConfig | undefined = undefined>(
      toolConfig?: TConfig,
    ): RetrieverTools<TConfig> => handle.retriever().asTools(toolConfig),
    assertions: (stage, options) => createAssertionSet({
      records: config.records, indexerId: config.id, namespace: config.namespace, stage,
      ...(options?.types ? { selectedTypes: options.types } : {}), resolveRevision: availableRevision,
    }),
    inspect: () => ({
      id: registration.viewId,
      namespace: config.namespace,
      where: registration.where,
      ...(resolved ? { revisionHash: resolved.revisionHash } : {}),
    }),
  }
  const communityHandle = config.communities
    ? {
        communities: communities.surface,
      }
    : {}
  return Object.freeze({ ...handle, ...communityHandle }) as KnowledgeView<TMetadataSchema, TModality>
}

function requireObjectMetadataSchema(
  id: string,
  schema: z.ZodType<unknown> | undefined,
): z.ZodObject<z.ZodRawShape> {
  if (schema instanceof z.ZodObject) return schema
  throw new Error(`knowledgeBase("${id}").view() requires an object metadataSchema.`)
}
