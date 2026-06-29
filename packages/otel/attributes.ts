/**
 * OpenTelemetry GenAI semantic convention attribute constants.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 * @module
 */

// ─────────────────────────────────────────────────────────────────
// GenAI Semantic Conventions
// ─────────────────────────────────────────────────────────────────

/** The GenAI system (e.g., 'openai', 'anthropic'). */
export const GEN_AI_SYSTEM = 'gen_ai.system'

/** The model requested by the caller. */
export const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model'

/** The model actually used (may differ from requested). */
export const GEN_AI_RESPONSE_MODEL = 'gen_ai.response.model'

/** Number of input tokens consumed. */
export const GEN_AI_USAGE_INPUT_TOKENS = 'gen_ai.usage.input_tokens'

/** Number of output tokens generated. */
export const GEN_AI_USAGE_OUTPUT_TOKENS = 'gen_ai.usage.output_tokens'

/** Finish reason(s) for the generation. */
export const GEN_AI_RESPONSE_FINISH_REASONS = 'gen_ai.response.finish_reasons'

/** End-to-end client-side generation operation duration in milliseconds. */
export const GEN_AI_CLIENT_DURATION_MS = 'gen_ai.client.duration_ms'

/** Client-observed time to the first streamed output token in milliseconds. */
export const GEN_AI_CLIENT_TIME_TO_FIRST_TOKEN_MS = 'gen_ai.client.time_to_first_token_ms'

/** Client-observed output token throughput. */
export const GEN_AI_CLIENT_OUTPUT_TOKENS_PER_SECOND = 'gen_ai.client.output_tokens_per_second'

/** Mean client-observed interval between streamed output chunks in milliseconds. */
export const GEN_AI_CLIENT_TIME_PER_OUTPUT_CHUNK_MS = 'gen_ai.client.time_per_output_chunk_ms'

// ─────────────────────────────────────────────────────────────────
// Crux-specific attributes
// ─────────────────────────────────────────────────────────────────

/** Crux prompt ID. */
export const CRUX_PROMPT_ID = 'crux.prompt.id'

/** Estimated cost in USD. */
export const CRUX_COST = 'crux.cost'

/** Cost source: actual provider-reported cost or pricing estimate. */
export const CRUX_COST_SOURCE = 'crux.cost.source'

/** Configured cost budget threshold in USD. */
export const CRUX_COST_THRESHOLD = 'crux.cost.threshold'

/** Prompt/session/flow-attributed cost total in USD. */
export const CRUX_COST_TOTAL = 'crux.cost.total'

/** Embedding definition name. */
export const CRUX_EMBEDDING_NAME = 'crux.embedding.name'

/** Embedding kind (dense or sparse). */
export const CRUX_EMBEDDING_KIND = 'crux.embedding.kind'

/** Embedding operation (embed or embedMany). */
export const CRUX_EMBEDDING_OPERATION = 'crux.embedding.operation'

/** Embedding dimensions for dense embeddings. */
export const CRUX_EMBEDDING_DIMENSIONS = 'crux.embedding.dimensions'

/** Number of texts in an embedding request. */
export const CRUX_EMBEDDING_INPUT_COUNT = 'crux.embedding.input_count'

/** Number of internal chunks used by batching. */
export const CRUX_EMBEDDING_CHUNK_COUNT = 'crux.embedding.chunk_count'

/** Number of embedding cache hits. */
export const CRUX_EMBEDDING_CACHE_HIT_COUNT = 'crux.embedding.cache_hit_count'

/** Number of embedding cache misses. */
export const CRUX_EMBEDDING_CACHE_MISS_COUNT = 'crux.embedding.cache_miss_count'

/** Number of embedding provider retry attempts. */
export const CRUX_EMBEDDING_RETRY_COUNT = 'crux.embedding.retry_count'

/** Number of embedding inputs truncated before provider execution. */
export const CRUX_EMBEDDING_TRUNCATED_COUNT = 'crux.embedding.truncated_count'

/** Time spent waiting for embedding rate-limit capacity. */
export const CRUX_EMBEDDING_RATE_LIMIT_WAIT_MS = 'crux.embedding.rate_limit_wait_ms'

/** Retriever ID. */
export const CRUX_RETRIEVER_ID = 'crux.retriever.id'

/** Retrieval namespace. */
export const CRUX_RETRIEVAL_NAMESPACE = 'crux.retrieval.namespace'

/** Retrieval mode. */
export const CRUX_RETRIEVAL_MODE = 'crux.retrieval.mode'

/** Retrieval limit. */
export const CRUX_RETRIEVAL_LIMIT = 'crux.retrieval.limit'

/** Retrieval result count. */
export const CRUX_RETRIEVAL_RESULT_COUNT = 'crux.retrieval.result_count'

/** Retrieval fusion mode. */
export const CRUX_RETRIEVAL_FUSION = 'crux.retrieval.fusion'

/** Retrieval pipeline ID. */
export const CRUX_RETRIEVAL_PIPELINE_ID = 'crux.retrieval.pipeline.id'

/** Retrieval pipeline stage name. */
export const CRUX_RETRIEVAL_STAGE_NAME = 'crux.retrieval.stage.name'

/** Retrieval pipeline stage kind. */
export const CRUX_RETRIEVAL_STAGE_KIND = 'crux.retrieval.stage.kind'

/** Retrieval pipeline stage phase. */
export const CRUX_RETRIEVAL_STAGE_PHASE = 'crux.retrieval.stage.phase'

/** Retrieval pipeline stage input query count. */
export const CRUX_RETRIEVAL_STAGE_INPUT_QUERY_COUNT = 'crux.retrieval.stage.input_query_count'

/** Retrieval pipeline stage output query count. */
export const CRUX_RETRIEVAL_STAGE_OUTPUT_QUERY_COUNT = 'crux.retrieval.stage.output_query_count'

/** Retrieval pipeline stage input hit count. */
export const CRUX_RETRIEVAL_STAGE_INPUT_HIT_COUNT = 'crux.retrieval.stage.input_hit_count'

/** Retrieval pipeline stage output hit count. */
export const CRUX_RETRIEVAL_STAGE_OUTPUT_HIT_COUNT = 'crux.retrieval.stage.output_hit_count'

/** Retrieval pipeline stage warning count. */
export const CRUX_RETRIEVAL_STAGE_WARNING_COUNT = 'crux.retrieval.stage.warning_count'

/** Workspace ID. */
export const CRUX_WORKSPACE_ID = 'crux.workspace.id'

/** Workspace operation. */
export const CRUX_WORKSPACE_OPERATION = 'crux.workspace.operation'

/** Workspace mount path. */
export const CRUX_WORKSPACE_MOUNT = 'crux.workspace.mount'

/** Workspace MIME type. */
export const CRUX_WORKSPACE_MIME_TYPE = 'crux.workspace.mime_type'

/** Workspace file size in bytes. */
export const CRUX_WORKSPACE_SIZE = 'crux.workspace.size'

/** Privacy-safe hash of the workspace path. */
export const CRUX_WORKSPACE_PATH_HASH = 'crux.workspace.path_hash'

/** Workspace operation status. */
export const CRUX_WORKSPACE_STATUS = 'crux.workspace.status'

/** Indexer ID. */
export const CRUX_INDEXER_ID = 'crux.indexer.id'

/** Index namespace. */
export const CRUX_INDEX_NAMESPACE = 'crux.index.namespace'

/** Index operation. */
export const CRUX_INDEX_OPERATION = 'crux.index.operation'

/** Indexed source count. */
export const CRUX_INDEX_SOURCE_COUNT = 'crux.index.source_count'

/** Indexed chunk count. */
export const CRUX_INDEX_CHUNK_COUNT = 'crux.index.chunk_count'

/** Deleted chunk count. */
export const CRUX_INDEX_DELETED_COUNT = 'crux.index.deleted_count'

/** Number of recorded pipeline/source stages. */
export const CRUX_INDEX_STAGE_COUNT = 'crux.index.stage_count'

/** Number of pipeline stage cache hits. */
export const CRUX_INDEX_STAGE_CACHE_HIT_COUNT = 'crux.index.stage_cache_hit_count'

/** Corpus ID. */
export const CRUX_CORPUS_ID = 'crux.corpus.id'

/** Hashed corpus namespace. */
export const CRUX_CORPUS_NAMESPACE_HASH = 'crux.corpus.namespace_hash'

/** Corpus sync mode. */
export const CRUX_CORPUS_MODE = 'crux.corpus.mode'

/** Corpus stale policy. */
export const CRUX_CORPUS_STALE_POLICY = 'crux.corpus.stale_policy'

/** Corpus source set completeness. */
export const CRUX_CORPUS_SOURCE_SET = 'crux.corpus.source_set'

/** Whether corpus/indexing work was a dry run. */
export const CRUX_CORPUS_DRY_RUN = 'crux.corpus.dry_run'

/** Hashed corpus source ID. */
export const CRUX_CORPUS_SOURCE_ID_HASH = 'crux.corpus.source_id_hash'

/** Corpus source action. */
export const CRUX_CORPUS_ACTION = 'crux.corpus.action'

/** Corpus source action reason. */
export const CRUX_CORPUS_REASON = 'crux.corpus.reason'

/** Corpus source/sync chunk count. */
export const CRUX_CORPUS_CHUNK_COUNT = 'crux.corpus.chunk_count'

/** Corpus source count. */
export const CRUX_CORPUS_SOURCE_COUNT = 'crux.corpus.source_count'

/** Corpus added source count. */
export const CRUX_CORPUS_ADDED_COUNT = 'crux.corpus.added_count'

/** Corpus changed source count. */
export const CRUX_CORPUS_CHANGED_COUNT = 'crux.corpus.changed_count'

/** Corpus unchanged source count. */
export const CRUX_CORPUS_UNCHANGED_COUNT = 'crux.corpus.unchanged_count'

/** Corpus stale source count. */
export const CRUX_CORPUS_STALE_COUNT = 'crux.corpus.stale_count'

/** Corpus skipped source count. */
export const CRUX_CORPUS_SKIPPED_COUNT = 'crux.corpus.skipped_count'

/** Corpus deleted source count. */
export const CRUX_CORPUS_DELETED_COUNT = 'crux.corpus.deleted_count'

/** Corpus failed source count. */
export const CRUX_CORPUS_FAILED_COUNT = 'crux.corpus.failed_count'

/** Ingest parser name. */
export const CRUX_INGEST_PARSER = 'crux.ingest.parser'

/** Ingest source format. */
export const CRUX_INGEST_FORMAT = 'crux.ingest.format'

/** Hashed ingest namespace. */
export const CRUX_INGEST_NAMESPACE_HASH = 'crux.ingest.namespace_hash'

/** Hashed ingest source ID. */
export const CRUX_INGEST_SOURCE_ID_HASH = 'crux.ingest.source_id_hash'

/** Ingest source byte length. */
export const CRUX_INGEST_BYTE_LENGTH = 'crux.ingest.byte_length'

/** Parsed ingest part count. */
export const CRUX_INGEST_PART_COUNT = 'crux.ingest.part_count'

/** Ingest parser warning count. */
export const CRUX_INGEST_WARNING_COUNT = 'crux.ingest.warning_count'

/** Tool name. */
export const CRUX_TOOL_NAME = 'crux.tool.name'

/** Tool call ID. */
export const CRUX_TOOL_CALL_ID = 'crux.tool.call_id'

/** Tool approval ID. */
export const CRUX_TOOL_APPROVAL_ID = 'crux.tool.approval.id'

/** Tool approval decision. */
export const CRUX_TOOL_APPROVAL_APPROVED = 'crux.tool.approval.approved'

/** Whether tool timing was estimated (not measured). */
export const CRUX_TOOL_ESTIMATED = 'crux.tool.estimated'

/** Model-facing tool output shape. */
export const CRUX_TOOL_MODEL_OUTPUT_TYPE = 'crux.tool.model_output.type'

/** Approximate serialized size of the raw tool output. */
export const CRUX_TOOL_OUTPUT_SIZE = 'crux.tool.output.size'

/** Approximate serialized size of the model-facing tool output. */
export const CRUX_TOOL_MODEL_OUTPUT_SIZE = 'crux.tool.model_output.size'

/** Approximate raw minus model-output size. */
export const CRUX_TOOL_TOKEN_SAVINGS_ESTIMATE = 'crux.tool.token_savings_estimate'

/** Flow ID. */
export const CRUX_FLOW_ID = 'crux.flow.id'

/** Flow name. */
export const CRUX_FLOW_NAME = 'crux.flow.name'

/** Parent flow ID (for nested flows). */
export const CRUX_FLOW_PARENT_ID = 'crux.flow.parent_id'

/** Step ID within a flow. */
export const CRUX_STEP_ID = 'crux.step.id'

/** Step label within a flow. */
export const CRUX_STEP_LABEL = 'crux.step.label'

/** Composition ID. */
export const CRUX_COMPOSITION_ID = 'crux.composition.id'

/** Composition kind (parallel, pipeline, consensus, swarm). */
export const CRUX_COMPOSITION_KIND = 'crux.composition.kind'

/** Number of agents in a composition. */
export const CRUX_COMPOSITION_AGENT_COUNT = 'crux.composition.agent_count'

/** Number of handoffs in a swarm composition. */
export const CRUX_COMPOSITION_HANDOFF_COUNT = 'crux.composition.handoff_count'

/** Consensus agreement ratio (0-1). */
export const CRUX_COMPOSITION_AGREEMENT = 'crux.composition.agreement'

/** Memory type (working, episodic, semantic, block). */
export const CRUX_MEMORY_TYPE = 'crux.memory.type'

/** Memory operation (get, set, recall, record, etc.). */
export const CRUX_MEMORY_OPERATION = 'crux.memory.operation'

/** Memory block ID for block-based memory events. */
export const CRUX_MEMORY_BLOCK_ID = 'crux.memory.block.id'

/** Memory block kind for block-based memory events. */
export const CRUX_MEMORY_BLOCK_KIND = 'crux.memory.block.kind'

/** Hashed memory namespace for privacy-safe correlation. */
export const CRUX_MEMORY_NAMESPACE_HASH = 'crux.memory.namespace_hash'

/** Memory write mode (manual, propose, auto). */
export const CRUX_MEMORY_WRITE_MODE = 'crux.memory.write_mode'

/** Proposal status for proposed memory writes. */
export const CRUX_MEMORY_PROPOSAL_STATUS = 'crux.memory.proposal_status'

/** Compaction compression ratio. */
export const CRUX_COMPACTION_RATIO = 'crux.compaction.ratio'

/** Judge metric name. */
export const CRUX_JUDGE_METRIC = 'crux.judge.metric'

/** Judge score. */
export const CRUX_JUDGE_SCORE = 'crux.judge.score'

/** Plan ID. */
export const CRUX_PLAN_ID = 'crux.plan.id'

/** Plan version. */
export const CRUX_PLAN_VERSION = 'crux.plan.version'

/** Task list ID. */
export const CRUX_TASKLIST_ID = 'crux.tasklist.id'

/** Task ID. */
export const CRUX_TASK_ID = 'crux.task.id'

/** Task status. */
export const CRUX_TASK_STATUS = 'crux.task.status'

/** Context cache status (hit or miss). */
export const CRUX_CONTEXT_CACHE_STATUS = 'crux.context.cache.status'

/** Context ID for cache events. */
export const CRUX_CONTEXT_ID = 'crux.context.id'

/** Context cache TTL in milliseconds. */
export const CRUX_CONTEXT_CACHE_AGE_MS = 'crux.context.cache.age_ms'

/** Semantic cache prompt version. */
export const CRUX_SEMANTIC_CACHE_VERSION = 'crux.semantic_cache.version'

/** Semantic cache lookup/write operation. */
export const CRUX_SEMANTIC_CACHE_OPERATION = 'crux.semantic_cache.operation'

/** Semantic cache lookup status. */
export const CRUX_SEMANTIC_CACHE_STATUS = 'crux.semantic_cache.status'

/** Semantic cache similarity threshold. */
export const CRUX_SEMANTIC_CACHE_THRESHOLD = 'crux.semantic_cache.threshold'

/** Semantic cache similarity score. */
export const CRUX_SEMANTIC_CACHE_SCORE = 'crux.semantic_cache.score'

/** Semantic cache entry age in milliseconds. */
export const CRUX_SEMANTIC_CACHE_AGE_MS = 'crux.semantic_cache.age_ms'

/** Semantic cache TTL in milliseconds. */
export const CRUX_SEMANTIC_CACHE_TTL_MS = 'crux.semantic_cache.ttl_ms'

// ── Skill Attributes ────────────────────────────────────────────

/** Skill ID for skill events. */
export const CRUX_SKILL_ID = 'crux.skill.id'

/** Skill source (file, registry, or inline). */
export const CRUX_SKILL_SOURCE = 'crux.skill.source'

/** Skill cache status (hit or miss). */
export const CRUX_SKILL_CACHE_STATUS = 'crux.skill.cache.status'

// ── Routing Attributes ─────────────────────────────────────────

/** Router classification label. */
export const CRUX_ROUTER_CLASSIFIED_AS = 'crux.router.classified_as'

/** Router selected model ID. */
export const CRUX_ROUTER_SELECTED_MODEL = 'crux.router.selected_model'

/** Whether a route was forced via .select(). */
export const CRUX_ROUTER_OVERRIDDEN = 'crux.router.overridden'

/** Cascade tier index (0-based). */
export const CRUX_CASCADE_TIER_INDEX = 'crux.cascade.tier_index'

/** Cascade tier model. */
export const CRUX_CASCADE_TIER_MODEL = 'crux.cascade.tier_model'

/** Cascade tier status (accepted, rejected, skipped). */
export const CRUX_CASCADE_TIER_STATUS = 'crux.cascade.tier_status'

/** Cascade total tiers. */
export const CRUX_CASCADE_TOTAL_TIERS = 'crux.cascade.total_tiers'

/** Cascade accepted tier index. */
export const CRUX_CASCADE_ACCEPTED_TIER = 'crux.cascade.accepted_tier'

/** Whether cascade budget was exceeded. */
export const CRUX_CASCADE_BUDGET_EXCEEDED = 'crux.cascade.budget_exceeded'

// ── Constraint semantic attributes ──
export const CRUX_CONSTRAINT_NAME = 'crux.constraint.name'
export const CRUX_CONSTRAINT_SEVERITY = 'crux.constraint.severity'
export const CRUX_CONSTRAINT_PASS = 'crux.constraint.pass'
export const CRUX_CONSTRAINT_ATTEMPT = 'crux.constraint.attempt'
