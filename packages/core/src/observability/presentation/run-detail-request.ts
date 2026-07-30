import type {
  CruxArtifactId,
  CruxContextContributionPreview,
  CruxPrimitiveName,
  CruxPromptBudgetPreview,
  CruxPromptTextUserPromptPreview,
  CruxSpanId,
  CruxSpanStatus,
} from '../contract'

/** Node selected to represent an exact, inherited, or aggregate request. */
export interface CruxRunDetailRequestRepresentative {
  spanId: CruxSpanId | string
  strategy: 'self' | 'final-generation' | 'nearest-ancestor-request' | string
  reason?: string
}

/** Distinct model/provider group represented inside a request summary. */
export interface CruxRunDetailRequestModel {
  model?: string
  provider?: string
  spanIds: readonly (CruxSpanId | string)[]
  count: number
}

/** Model/provider roll-up for a run-detail request panel. */
export interface CruxRunDetailRequestModelSummary {
  primaryModel?: string
  primaryProvider?: string
  mixed: boolean
  models: readonly CruxRunDetailRequestModel[]
}

/** Base prompt content inferred for a request projection. */
export interface CruxRunDetailRequestBasePrompt {
  sourceId: 'prompt' | string
  text?: string
  segments?: CruxContextContributionPreview['segments']
  tokens?: number
  staticTokens?: number
  dynamicTokens?: number
}

/** Request-shaped message payloads surfaced without requiring artifact walks. */
export interface CruxRunDetailRequestMessages {
  artifactId?: CruxArtifactId | string
  source?: string
  phase?: string
  input?: unknown
  system?: unknown
  prompt?: unknown
  messages?: unknown
  allMessages?: unknown
  inputMessages?: unknown
  inputPrompt?: unknown
  recent?: unknown
  existingResponses?: unknown
  search?: unknown
  previousStepMessages?: unknown
}

/** Context contribution included in the effective request projection. */
export interface CruxRunDetailRequestContribution extends CruxContextContributionPreview {
  artifactId?: CruxArtifactId | string
  order: number
}

/** Prompt budget included in the effective request projection. */
export interface CruxRunDetailRequestBudget extends CruxPromptBudgetPreview {
  artifactId?: CruxArtifactId | string
}

/** Tool made available to the represented generation request. */
export interface CruxRunDetailRequestTool {
  name: string
  origin: 'request' | 'injected' | string
  sourceId?: string
  artifactId?: CruxArtifactId | string
}

/** Generation turn participating in an aggregate request projection. */
export interface CruxRunDetailRequestTurn {
  spanId: CruxSpanId | string
  primitive: CruxPrimitiveName | string
  label: string
  startedAt?: string
  status?: CruxSpanStatus | string
  requestMode: 'exact' | 'inherited' | 'aggregate' | string
  model?: string
  provider?: string
  promptId?: string
}

/** Effective request displayed for a run-detail node or detail. */
export interface CruxRunDetailRequest {
  mode: 'exact' | 'inherited' | 'aggregate' | string
  representative?: CruxRunDetailRequestRepresentative
  modelSummary?: CruxRunDetailRequestModelSummary
  basePrompt?: CruxRunDetailRequestBasePrompt
  /** Exact captured user PromptText, absent for strings and invalid/redacted evidence. */
  userPrompt?: CruxPromptTextUserPromptPreview
  messages?: CruxRunDetailRequestMessages
  contributions: CruxRunDetailRequestContribution[]
  budget?: CruxRunDetailRequestBudget
  tools: CruxRunDetailRequestTool[]
  turns?: CruxRunDetailRequestTurn[]
  diagnostics?: string[]
}
