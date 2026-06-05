import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, setRuntime, getRuntime } from '@crux/core'
import { withTelemetry } from '../index'
import type { TraceSpan } from '../types'

describe('OTel hooks — tool spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('onToolStart + onToolEnd creates a span named crux.tool.{toolName}', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })

    const result = plugin.install({})
    setRuntime({ ...result })

    const hooks = result.instrumentationHooks!

    hooks.onToolStart!({
      toolCallId: 'tc1',
      toolName: 'webSearch',
      args: { query: 'test' },
    })

    hooks.onToolEnd!({
      toolCallId: 'tc1',
      toolName: 'webSearch',
      durationMs: 150,
      result: { results: [] },
      modelOutputType: 'text',
      outputSize: 10,
      modelOutputSize: 4,
      tokenSavingsEstimate: 6,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.tool.webSearch')
    expect(spans[0].attributes['crux.tool.name']).toBe('webSearch')
    expect(spans[0].attributes['crux.tool.call_id']).toBe('tc1')
    expect(spans[0].attributes['crux.tool.model_output.type']).toBe('text')
    expect(spans[0].attributes['crux.tool.output.size']).toBe(10)
    expect(spans[0].attributes['crux.tool.model_output.size']).toBe(4)
    expect(spans[0].attributes['crux.tool.token_savings_estimate']).toBe(6)
  })

  it('onWorkspaceOperation creates privacy-safe workspace spans', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onWorkspaceOperation!({
      workspaceId: 'research',
      namespace: 'thread:secret',
      operation: 'write',
      path: '/outputs/private-report.pdf',
      status: 'success',
      durationMs: 12,
      mimeType: 'application/pdf',
      size: 42,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.workspace.write')
    expect(spans[0].attributes['crux.workspace.id']).toBe('research')
    expect(spans[0].attributes['crux.workspace.operation']).toBe('write')
    expect(spans[0].attributes['crux.workspace.status']).toBe('success')
    expect(spans[0].attributes['crux.workspace.mime_type']).toBe('application/pdf')
    expect(spans[0].attributes['crux.workspace.size']).toBe(42)
    expect(spans[0].attributes['crux.workspace.path_hash']).toBeTypeOf('string')
    expect(Object.values(spans[0].attributes)).not.toContain('/outputs/private-report.pdf')
    expect(Object.values(spans[0].attributes)).not.toContain('thread:secret')
  })

  it('sets span status to ERROR when tool fails', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onToolStart!({
      toolCallId: 'tc2',
      toolName: 'fetchUrl',
      args: { url: 'https://example.com' },
    })

    hooks!.onToolEnd!({
      toolCallId: 'tc2',
      toolName: 'fetchUrl',
      durationMs: 500,
      error: 'Connection timeout',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('Connection timeout')
  })

  it('flags estimated tool spans', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onToolStart!({
      toolCallId: 'tc3',
      toolName: 'calculator',
      args: {},
    })

    hooks!.onToolEnd!({
      toolCallId: 'tc3',
      toolName: 'calculator',
      durationMs: 10,
      estimated: true,
    })

    expect(spans[0].attributes['crux.tool.estimated']).toBe(true)
  })

  it('ignores onToolEnd for unknown toolCallId (no crash)', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    // End without start — should not crash or produce a span
    hooks!.onToolEnd!({
      toolCallId: 'unknown',
      toolName: 'test',
      durationMs: 10,
    })

    expect(spans).toHaveLength(0)
  })
})

describe('OTel hooks - cost spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('creates spans for cost report and budget events', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})
    const breakdown = {
      cost: 0.25,
      inputTokens: 1000,
      outputTokens: 2000,
      totalTokens: 3000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      calls: 1,
    }
    const entry = {
      id: 'tr-1',
      timestamp: Date.now(),
      source: 'actual' as const,
      ...breakdown,
      traceId: 'tr-1',
      promptId: 'summarize',
      model: 'gpt-4o',
      provider: 'openai',
    }
    const report = {
      total: breakdown,
      byPrompt: { summarize: breakdown },
      byModel: { 'gpt-4o': breakdown },
      byProvider: { openai: breakdown },
      byAgent: {},
      byFlow: {},
      bySession: {},
      byStep: {},
      entries: [entry],
    }

    hooks!.onCostReport!({ timestamp: Date.now(), entry, report })
    hooks!.onCostWarn!({ timestamp: Date.now(), entry, report, threshold: 0.1, actual: 0.25 })

    expect(spans).toHaveLength(2)
    expect(spans[0].name).toBe('crux.cost.report')
    expect(spans[0].attributes['crux.cost']).toBe(0.25)
    expect(spans[0].attributes['crux.cost.source']).toBe('actual')
    expect(spans[1].name).toBe('crux.cost.warn')
    expect(spans[1].attributes['crux.cost.threshold']).toBe(0.1)
  })
})

describe('OTel hooks - embedding spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('records privacy-safe embedding governance attributes', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onEmbedStart!({
      embedId: 'emb-1',
      name: 'docs',
      kind: 'dense',
      operation: 'embedMany',
      inputCount: 3,
      chunkCount: 2,
      maxChunkSize: 2,
      dimensions: 1536,
    })
    hooks!.onEmbedEnd!({
      embedId: 'emb-1',
      name: 'docs',
      kind: 'dense',
      operation: 'embedMany',
      inputCount: 3,
      chunkCount: 2,
      maxChunkSize: 2,
      dimensions: 1536,
      durationMs: 20,
      cacheHitCount: 2,
      cacheMissCount: 1,
      retryCount: 1,
      truncatedCount: 1,
      rateLimitWaitMs: 4,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].attributes['crux.embedding.cache_hit_count']).toBe(2)
    expect(spans[0].attributes['crux.embedding.cache_miss_count']).toBe(1)
    expect(spans[0].attributes['crux.embedding.retry_count']).toBe(1)
    expect(spans[0].attributes['crux.embedding.truncated_count']).toBe(1)
    expect(spans[0].attributes['crux.embedding.rate_limit_wait_ms']).toBe(4)
  })
})

describe('OTel hooks - retrieval/indexing spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('creates a retrieval span with result count', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onRetrievalStart!({
      retrievalId: 'ret1',
      retrieverId: 'docs',
      namespace: 'knowledge',
      mode: 'hybrid',
      query: 'What is hybrid retrieval?',
      limit: 5,
      fusion: 'dbsf',
    })

    hooks!.onRetrievalEnd!({
      retrievalId: 'ret1',
      retrieverId: 'docs',
      namespace: 'knowledge',
      mode: 'hybrid',
      query: 'What is hybrid retrieval?',
      limit: 5,
      fusion: 'dbsf',
      resultCount: 3,
      durationMs: 14,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.retrieval')
    expect(spans[0].attributes['crux.retriever.id']).toBe('docs')
    expect(spans[0].attributes['crux.retrieval.mode']).toBe('hybrid')
    expect(spans[0].attributes['crux.retrieval.result_count']).toBe(3)
    expect(spans[0].attributes['crux.retrieval.fusion']).toBe('dbsf')
  })

  it('creates privacy-safe retrieval stage spans', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onRetrievalStageStart!({
      retrievalId: 'ret1',
      retrieverId: 'docs',
      pipelineId: 'docs',
      stageName: 'multi-query',
      stageKind: 'multi-query',
      phase: 'query',
      inputQueryCount: 1,
    })

    hooks!.onRetrievalStageEnd!({
      retrievalId: 'ret1',
      retrieverId: 'docs',
      pipelineId: 'docs',
      stageName: 'multi-query',
      stageKind: 'multi-query',
      phase: 'query',
      status: 'success',
      inputQueryCount: 1,
      outputQueryCount: 4,
      durationMs: 10,
      warningCount: 0,
      preview: {
        queries: [{ query: 'private user query' }],
      },
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.retrieval.stage')
    expect(spans[0].attributes['crux.retrieval.pipeline.id']).toBe('docs')
    expect(spans[0].attributes['crux.retrieval.stage.name']).toBe('multi-query')
    expect(spans[0].attributes['crux.retrieval.stage.output_query_count']).toBe(4)
    expect(JSON.stringify(spans[0].attributes)).not.toContain('private user query')
  })

  it('creates an indexing span and marks errors', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onIndexStart!({
      indexId: 'idx1',
      indexerId: 'docs',
      namespace: 'knowledge',
      operation: 'indexDocuments',
      sourceCount: 2,
      chunkCount: 6,
      replaceSources: true,
    })

    hooks!.onIndexEnd!({
      indexId: 'idx1',
      indexerId: 'docs',
      namespace: 'knowledge',
      operation: 'indexDocuments',
      sourceCount: 2,
      chunkCount: 6,
      replaceSources: true,
      durationMs: 22,
      error: 'write failed',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.indexing')
    expect(spans[0].attributes['crux.indexer.id']).toBe('docs')
    expect(spans[0].attributes['crux.index.operation']).toBe('indexDocuments')
    expect(spans[0].attributes['crux.index.chunk_count']).toBe(6)
    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('write failed')
  })

  it('creates corpus sync and source spans without raw source identifiers', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCorpusSyncStart!({
      syncId: 'sync1',
      corpusId: 'docs',
      namespace: 'tenant-a',
      mode: 'replaceChanged',
      stalePolicy: 'keep',
      sourceSet: 'partial',
      dryRun: false,
      sourceCount: 1,
    })

    hooks!.onCorpusSource!({
      syncId: 'sync1',
      corpusId: 'docs',
      namespace: 'tenant-a',
      sourceId: 'private/path/guide.md',
      action: 'added',
      reason: 'new',
      dryRun: false,
      chunkCount: 4,
    })

    hooks!.onCorpusSyncEnd!({
      syncId: 'sync1',
      corpusId: 'docs',
      namespace: 'tenant-a',
      mode: 'replaceChanged',
      stalePolicy: 'keep',
      sourceSet: 'partial',
      dryRun: false,
      added: 1,
      changed: 0,
      unchanged: 0,
      stale: 0,
      skipped: 0,
      deleted: 0,
      failed: 0,
      chunkCount: 4,
      durationMs: 12,
    })

    expect(spans).toHaveLength(2)
    expect(spans[0].name).toBe('crux.corpus.source')
    expect(spans[0].attributes['crux.corpus.id']).toBe('docs')
    expect(spans[0].attributes['crux.corpus.source_id_hash']).toBeTypeOf('string')
    expect(spans[0].attributes['crux.corpus.source_id_hash']).not.toBe('private/path/guide.md')
    expect(spans[0].attributes['crux.corpus.action']).toBe('added')
    expect(spans[1].name).toBe('crux.corpus.sync')
    expect(spans[1].attributes['crux.corpus.added_count']).toBe(1)
    expect(spans[1].attributes['crux.corpus.chunk_count']).toBe(4)
  })

  it('creates ingest parser spans without raw source identifiers', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onIngestParseStart!({
      ingestId: 'ing1',
      parser: 'pdf',
      format: 'pdf',
      namespace: 'tenant-a',
      sourceId: 'private/path/guide.pdf',
      byteLength: 1024,
    })

    hooks!.onIngestParseEnd!({
      ingestId: 'ing1',
      parser: 'pdf',
      format: 'pdf',
      namespace: 'tenant-a',
      sourceId: 'private/path/guide.pdf',
      byteLength: 1024,
      durationMs: 18,
      partCount: 3,
      warningCount: 1,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.ingest.parse')
    expect(spans[0].attributes['crux.ingest.parser']).toBe('pdf')
    expect(spans[0].attributes['crux.ingest.format']).toBe('pdf')
    expect(spans[0].attributes['crux.ingest.source_id_hash']).toBeTypeOf('string')
    expect(spans[0].attributes['crux.ingest.source_id_hash']).not.toBe('private/path/guide.pdf')
    expect(spans[0].attributes['crux.ingest.part_count']).toBe(3)
    expect(spans[0].attributes['crux.ingest.warning_count']).toBe(1)
  })
})

describe('OTel hooks — embedding spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('onEmbedStart + onEmbedEnd creates a span named crux.embedding', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onEmbedStart!({
      embedId: 'emb1',
      name: 'dense-test',
      kind: 'dense',
      operation: 'embedMany',
      inputCount: 3,
      chunkCount: 2,
      maxChunkSize: 2,
      dimensions: 1536,
    })

    hooks!.onEmbedEnd!({
      embedId: 'emb1',
      name: 'dense-test',
      kind: 'dense',
      operation: 'embedMany',
      inputCount: 3,
      chunkCount: 2,
      maxChunkSize: 2,
      dimensions: 1536,
      durationMs: 42,
      usage: { inputTokens: 11, totalTokens: 11 },
      cost: 0.01,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.embedding')
    expect(spans[0].attributes['crux.embedding.name']).toBe('dense-test')
    expect(spans[0].attributes['crux.embedding.kind']).toBe('dense')
    expect(spans[0].attributes['gen_ai.usage.input_tokens']).toBe(11)
    expect(spans[0].attributes['crux.cost']).toBe(0.01)
  })

  it('marks embedding spans as errors', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onEmbedStart!({
      embedId: 'emb2',
      name: 'sparse-test',
      kind: 'sparse',
      operation: 'embed',
      inputCount: 1,
      chunkCount: 1,
      maxChunkSize: 1,
    })

    hooks!.onEmbedEnd!({
      embedId: 'emb2',
      name: 'sparse-test',
      kind: 'sparse',
      operation: 'embed',
      inputCount: 1,
      chunkCount: 1,
      maxChunkSize: 1,
      durationMs: 10,
      error: 'boom',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('boom')
  })
})

describe('OTel hooks — flow/step spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('onFlowStart + onFlowEnd creates a span named crux.flow', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onFlowStart!({
      flowId: 'f1',
      name: 'content-pipeline',
      startedAt: 1,
    })

    hooks!.onFlowEnd!({
      flowId: 'f1',
      name: 'content-pipeline',
      status: 'success',
      durationMs: 500,
      totalSteps: 2,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.flow')
    expect(spans[0].attributes['crux.flow.id']).toBe('f1')
    expect(spans[0].attributes['crux.flow.name']).toBe('content-pipeline')
  })

  it('onStepStart + onStepEnd creates a span named crux.flow.step', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onStepStart!({
      flowId: 'f1',
      stepId: 'research-1',
      label: 'Research',
    })

    hooks!.onStepEnd!({
      flowId: 'f1',
      stepId: 'research-1',
      label: 'Research',
      status: 'success',
      durationMs: 200,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.flow.step')
    expect(spans[0].attributes['crux.step.id']).toBe('research-1')
    expect(spans[0].attributes['crux.step.label']).toBe('Research')
  })

  it('flow error sets span status to ERROR', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onFlowStart!({ flowId: 'f2', name: 'failing', startedAt: 1 })
    hooks!.onFlowEnd!({
      flowId: 'f2',
      name: 'failing',
      status: 'error',
      durationMs: 100,
      totalSteps: 0,
      error: 'Pipeline failed',
    })

    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('Pipeline failed')
  })
})

describe('OTel hooks — composition spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('onCompositionStart + onCompositionEnd creates a parent span', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCompositionStart!({
      compositionId: 'c1',
      kind: 'parallel',
      agentIds: ['researcher', 'writer'],
    })

    hooks!.onCompositionEnd!({
      compositionId: 'c1',
      kind: 'parallel',
      status: 'success',
      durationMs: 1000,
      agentCount: 2,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.composition.parallel')
    expect(spans[0].attributes['crux.composition.id']).toBe('c1')
    expect(spans[0].attributes['crux.composition.kind']).toBe('parallel')
  })

  it('onCompositionAgent creates a child span', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCompositionAgent!({
      compositionId: 'c1',
      agentId: 'researcher',
      index: 0,
      status: 'success',
      durationMs: 500,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.composition.agent.researcher')
  })

  it('records swarm handoff attributes', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCompositionStart!({
      compositionId: 'c2',
      kind: 'swarm',
      agentIds: ['a', 'b', 'c'],
      startAgent: 'a',
      maxHandoffs: 5,
    })

    hooks!.onCompositionEnd!({
      compositionId: 'c2',
      kind: 'swarm',
      status: 'success',
      durationMs: 2000,
      agentCount: 3,
      handoffCount: 2,
      handoffPath: ['a', 'b', 'c'],
      finalAgentId: 'c',
    })

    expect(spans[0].attributes['crux.composition.kind']).toBe('swarm')
    expect(spans[0].attributes['crux.composition.handoff_count']).toBe(2)
  })

  it('records consensus agreement', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCompositionStart!({
      compositionId: 'c3',
      kind: 'consensus',
      agentIds: ['a', 'b', 'c'],
    })

    hooks!.onCompositionEnd!({
      compositionId: 'c3',
      kind: 'consensus',
      status: 'success',
      durationMs: 1500,
      agentCount: 3,
      agreement: 0.67,
    })

    expect(spans[0].attributes['crux.composition.agreement']).toBe(0.67)
  })

  it('error composition sets span status to ERROR', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onCompositionStart!({
      compositionId: 'c4',
      kind: 'pipeline',
      agentIds: ['a'],
    })

    hooks!.onCompositionEnd!({
      compositionId: 'c4',
      kind: 'pipeline',
      status: 'error',
      durationMs: 100,
      agentCount: 1,
    })

    expect(spans[0].status.code).toBe('ERROR')
  })
})

describe('OTel hooks — remaining hooks', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('onMemoryRead creates a crux.memory.read span', () => {
    const spans: TraceSpan[] = []
    const { instrumentationHooks: hooks } = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    }).install({})

    hooks!.onMemoryRead!({
      memoryId: 'm1',
      operation: 'recall',
      resultCount: 3,
      durationMs: 15,
      memoryType: 'episodic',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.memory.read')
    expect(spans[0].attributes['crux.memory.type']).toBe('episodic')
    expect(spans[0].attributes['crux.memory.operation']).toBe('recall')
  })

  it('onMemoryWrite creates a crux.memory.write span', () => {
    const spans: TraceSpan[] = []
    const { instrumentationHooks: hooks } = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    }).install({})

    hooks!.onMemoryWrite!({
      memoryId: 'm1',
      operation: 'record',
      memoryType: 'semantic',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.memory.write')
  })

  it('onCompactStart + onCompactEnd creates a crux.compact span', () => {
    const spans: TraceSpan[] = []
    const { instrumentationHooks: hooks } = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    }).install({})

    hooks!.onCompactStart!({
      reason: 'sliding-window',
      inputMessageCount: 20,
      inputTokens: 5000,
    })
    hooks!.onCompactEnd!({
      outputTokens: 1000,
      compressionRatio: 0.2,
      durationMs: 200,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.compact')
    expect(spans[0].attributes['crux.compaction.ratio']).toBe(0.2)
  })

  it('onJudgeResult creates a crux.judge span', () => {
    const spans: TraceSpan[] = []
    const { instrumentationHooks: hooks } = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    }).install({})

    hooks!.onJudgeResult!({
      metricId: 'relevance',
      score: 0.85,
      reasoning: 'On topic',
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.judge')
    expect(spans[0].attributes['crux.judge.metric']).toBe('relevance')
    expect(spans[0].attributes['crux.judge.score']).toBe(0.85)
  })

  it('onDelegateStart + onDelegateComplete creates a crux.delegate span', () => {
    const spans: TraceSpan[] = []
    const { instrumentationHooks: hooks } = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    }).install({})

    hooks!.onDelegateStart!({
      delegateId: 'd1',
      handoffId: 'h1',
      inputSize: 500,
    })
    hooks!.onDelegateComplete!({
      delegateId: 'd1',
      handoffId: 'h1',
      inputSize: 500,
      outputSize: 300,
      durationMs: 1000,
    })

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.delegate')
  })
})
