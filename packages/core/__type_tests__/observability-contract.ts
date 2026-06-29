import type {
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
} from '../observability'

const runId: CruxRunId = createCruxRunId('type_test')
const spanId: CruxSpanId = createCruxSpanId('type_test')
const artifactId: CruxArtifactId = createCruxArtifactId('type_test')

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
