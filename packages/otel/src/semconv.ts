/**
 * Versioned OpenTelemetry GenAI semantic convention mapping for Crux records.
 *
 * GenAI semconv is still a development-status convention. Keeping every
 * `gen_ai.*` name and operation mapping in this module makes upstream churn a
 * reviewed table edit instead of a sweep across the mapper implementation.
 *
 * @module
 */

import type { CruxPrimitiveName } from '@use-crux/core/observability'

/** Pinned GenAI semantic convention table version used by this package. */
export const SEMCONV_VERSION = 'genai-dev-2026-06' as const

/** The GenAI operation name for spans that map to the GenAI convention. */
export const GEN_AI_OPERATION_NAME = 'gen_ai.operation.name'

/** Provider name, replacing the older `gen_ai.system` attribute. */
export const GEN_AI_PROVIDER_NAME = 'gen_ai.provider.name'

/** The model requested by the caller. */
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model'

/** The model actually used by the provider, when reported. */
export const GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model'

/** Number of input tokens consumed. */
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens'

/** Number of output tokens generated. */
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens'

/** Generation finish reasons. Semconv expects an array even for one reason. */
export const GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons'

/** End-to-end client-side operation duration in seconds. */
export const GEN_AI_CLIENT_OPERATION_DURATION =
  'gen_ai.client.operation.duration'

/** Client-observed time to first token in seconds. */
export const GEN_AI_SERVER_TIME_TO_FIRST_TOKEN =
  'gen_ai.server.time_to_first_token'

/** Client-observed output token throughput. */
export const CRUX_GEN_OUTPUT_TOKENS_PER_SECOND =
  'crux.gen.output_tokens_per_second'

/** Mean client-observed interval between streamed output chunks in milliseconds. */
export const CRUX_GEN_TIME_PER_OUTPUT_CHUNK_MS =
  'crux.gen.time_per_output_chunk_ms'

/** Opt-in generation input message content. */
export const GEN_AI_INPUT_MESSAGES = 'gen_ai.input.messages'

/** Opt-in generation output message content. */
export const GEN_AI_OUTPUT_MESSAGES = 'gen_ai.output.messages'

/** Opt-in system instructions content. */
export const GEN_AI_SYSTEM_INSTRUCTIONS = 'gen_ai.system_instructions'

export type GenAiOperationName =
  | 'chat'
  | 'embeddings'
  | 'execute_tool'
  | 'invoke_agent'
  | 'invoke_workflow'
  | 'retrieval'
  | 'search_memory'
  | 'create_memory'

/** Fallback span names for every Crux primitive. GenAI primitives override these dynamically. */
export const primitiveSpanNames = {
  run: 'crux.run',
  'generation.call': 'crux.generation.call',
  'generation.stream': 'crux.generation.stream',
  'prompt.resolve': 'crux.prompt.resolve',
  'prompt.budget': 'crux.prompt.budget',
  'context.resolve': 'crux.context.resolve',
  'context.predicate': 'crux.context.predicate',
  'context.cache': 'crux.context.cache',
  'agent.run': 'crux.agent.run',
  'flow.run': 'crux.flow.run',
  'flow.step': 'crux.flow.step',
  'flow.suspension': 'crux.flow.suspension',
  'composition.parallel': 'crux.composition.parallel',
  'composition.pipeline': 'crux.composition.pipeline',
  'composition.consensus': 'crux.composition.consensus',
  'composition.swarm': 'crux.composition.swarm',
  'composition.branch': 'crux.composition.branch',
  'composition.join': 'crux.composition.join',
  'composition.vote': 'crux.composition.vote',
  'tool.call': 'crux.tool.call',
  'tool.approval': 'crux.tool.approval',
  'retrieval.pipeline': 'crux.retrieval.pipeline',
  'retrieval.recipe': 'crux.retrieval.recipe',
  'retrieval.retrieve': 'crux.retrieval.retrieve',
  'embedding.call': 'crux.embedding.call',
  'retrieval.query': 'crux.retrieval.query',
  'retrieval.stage': 'crux.retrieval.stage',
  'retrieval.step': 'crux.retrieval.step',
  'memory.read': 'crux.memory.read',
  'memory.write': 'crux.memory.write',
  'constraint.check': 'crux.constraint.check',
  'constraint.retry': 'crux.constraint.retry',
  'guardrail.run': 'crux.guardrail.run',
  'routing.router': 'crux.routing.router',
  'routing.split': 'crux.routing.split',
  'routing.retry': 'crux.routing.retry',
  'routing.cascade': 'crux.routing.cascade',
  'routing.fallback': 'crux.routing.fallback',
  'cache.lookup': 'crux.cache.lookup',
  'compaction.run': 'crux.compaction.run',
  'eval.run': 'crux.eval.run',
  'eval.case': 'crux.eval.case',
  'scoring.judge': 'crux.scoring.judge',
  'citation.check': 'crux.citation.check',
  'handoff.prepare': 'crux.handoff.prepare',
  'delegate.invoke': 'crux.delegate.invoke',
  'plan.operation': 'crux.plan.operation',
  'task.operation': 'crux.task.operation',
  'workspace.operation': 'crux.workspace.operation',
  'indexing.pipeline': 'crux.indexing.pipeline',
  'ingest.parse': 'crux.ingest.parse',
  'corpus.sync': 'crux.corpus.sync',
  'skill.load': 'crux.skill.load',
  'security.warning': 'crux.security.warning',
  'cost.record': 'crux.cost.record',
  'feedback.record': 'crux.feedback.record',
  'runtime.convex.action': 'crux.runtime.convex.action',
  'runtime.convex.query': 'crux.runtime.convex.query',
  'runtime.convex.mutation': 'crux.runtime.convex.mutation',
  'runtime.convex.schedule': 'crux.runtime.convex.schedule',
  'runtime.convex.resume': 'crux.runtime.convex.resume',
  'runtime.convex.flush': 'crux.runtime.convex.flush',
  'custom.operation': 'crux.custom.operation',
} satisfies Record<CruxPrimitiveName, string>

/** Resolve the GenAI operation for primitives covered by the GenAI convention. */
export function genAiOperationName(
  primitive: CruxPrimitiveName,
): GenAiOperationName | undefined {
  if (primitive === 'generation.call' || primitive === 'generation.stream')
    return 'chat'
  if (primitive === 'embedding.call') return 'embeddings'
  if (primitive === 'tool.call') return 'execute_tool'
  if (primitive === 'agent.run') return 'invoke_agent'
  if (primitive === 'flow.run' || primitive.startsWith('composition.'))
    return 'invoke_workflow'
  if (primitive.startsWith('retrieval.')) return 'retrieval'
  if (primitive === 'memory.read') return 'search_memory'
  if (primitive === 'memory.write') return 'create_memory'
  return undefined
}
