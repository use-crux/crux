import type { CruxArtifactId, CruxRunId, CruxSpanId } from '../observability'
import { createCruxArtifactId, createCruxRunId, createCruxSpanId } from '../observability'

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
