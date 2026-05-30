import type {
  CruxArtifactId,
  CruxEdgeId,
  CruxRecordId,
  CruxRunId,
  CruxSpanEventId,
  CruxSpanId,
  CruxTraceId,
} from './contract'

function randomSuffix(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export function createCruxRunId(seed: string = randomSuffix()): CruxRunId {
  return `run_${seed}` as CruxRunId
}

export function createCruxTraceId(seed: string = randomSuffix()): CruxTraceId {
  return `trace_${seed}` as CruxTraceId
}

export function createCruxSpanId(seed: string = randomSuffix()): CruxSpanId {
  return `span_${seed}` as CruxSpanId
}

export function createCruxSpanEventId(seed: string = randomSuffix()): CruxSpanEventId {
  return `event_${seed}` as CruxSpanEventId
}

export function createCruxEdgeId(seed: string = randomSuffix()): CruxEdgeId {
  return `edge_${seed}` as CruxEdgeId
}

export function createCruxArtifactId(seed: string = randomSuffix()): CruxArtifactId {
  return `artifact_${seed}` as CruxArtifactId
}

export function createCruxRecordId(seed: string = randomSuffix()): CruxRecordId {
  return `rec_${seed}` as CruxRecordId
}
