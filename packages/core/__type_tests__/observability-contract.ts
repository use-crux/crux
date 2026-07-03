import type {
  CruxAttributes,
  CruxCorrelators,
  CruxArtifactId,
  CruxGraphRecord,
  CruxObservabilityChannelMessage,
  CruxObservabilitySubscriber,
  CruxRunId,
  CruxSpanId,
} from '../observability'
import {
  CRUX_OBSERVABILITY_CHANNEL,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  createCruxArtifactId,
  createCruxRunId,
  createCruxSpanId,
  observe,
  propagateAttributes,
  subscribeObservability,
} from '../observability'

const runId: CruxRunId = createCruxRunId()
const spanId: CruxSpanId = createCruxSpanId()
const artifactId: CruxArtifactId = createCruxArtifactId()

const sameRunId: CruxRunId = runId
const sameSpanId: CruxSpanId = spanId
const sameArtifactId: CruxArtifactId = artifactId

void sameRunId
void sameSpanId
void sameArtifactId

// @ts-expect-error Run IDs and Span IDs must not be interchangeable.
const invalidSpanId: CruxSpanId = runId

// @ts-expect-error Artifact IDs and Run IDs must not be interchangeable.
const invalidRunId: CruxRunId = artifactId

void invalidSpanId
void invalidRunId

const channelName: 'crux:observability' = CRUX_OBSERVABILITY_CHANNEL

const subscriber: CruxObservabilitySubscriber = (record) => {
  const graphRecord: CruxGraphRecord = record
  const message: CruxObservabilityChannelMessage = {
    schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
    record,
  }
  void graphRecord
  void message
}

// @ts-expect-error Subscribers receive graph records, not arbitrary strings.
const invalidSubscriber: CruxObservabilitySubscriber = (record: string) => {
  void record
}

void channelName
void subscriber
void invalidSubscriber

subscribeObservability(['span:start'] as const, (record) => {
  const narrowedSpanId: CruxSpanId = record.spanId
  void narrowedSpanId

  // @ts-expect-error Start records do not have terminal timestamps.
  record.endedAt
})

subscribeObservability(['run:end', 'span:end'] as const, (record) => {
  if (record.type === 'span:end') {
    const narrowedSpanId: CruxSpanId = record.spanId
    void narrowedSpanId
  } else {
    const narrowedRunId: CruxRunId = record.runId
    void narrowedRunId
  }
})

const span = observe.openSpan({ name: 'type-test', primitive: 'custom.operation' })
const spanAttributes: CruxAttributes = { phase: 'compile' }
span.end({ attributes: spanAttributes })
span.setAttributes(spanAttributes)
span.end({ metrics: { inputTokens: 1, 'gen.duration_ms': 10, 'custom.cache_wait_ms': 2 } })

span.end({
  metrics: {
    // @ts-expect-error Custom metric keys must use the custom.* namespace.
    cacheWaitMs: 2,
  },
})

const inferredFamilySpan = observe.openSpan({ name: 'type-test', primitive: 'custom.operation' })
inferredFamilySpan.end()

observe.openSpan({
  name: 'typed-generation',
  primitive: 'generation.call',
  attributes: { mode: 'text', temperature: 0.2, finishReason: 'stop' },
})

observe.openSpan({
  name: 'typed-generation',
  primitive: 'generation.call',
  attributes: {
    mode: 'object',
    // @ts-expect-error Known primitive attributes keep their declared value types.
    temperature: 'warm',
  },
})

observe.openSpan({
  name: 'typed-generation',
  primitive: 'generation.call',
})

// @ts-expect-error Span attributes must be passed through `attributes` or `setAttributes`, not as raw end options.
span.end({ phase: 'compile' })

const correlators: CruxCorrelators = {
  sessionId: 'session-1',
  userId: 'user-1',
  metadata: { requestId: 'request-1' },
}
const propagated: number = propagateAttributes(correlators, () => 1)

// @ts-expect-error Correlator metadata values must be strings.
const invalidCorrelators: CruxCorrelators = { metadata: { attempt: 1 } }

void propagated
void invalidCorrelators
