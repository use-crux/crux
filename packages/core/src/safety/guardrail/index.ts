// ── Authoring API (execution goes through the Safety session — see ../session) ──
export { guardrail, isGuardrail, getGuardrailDefinitionSource } from './define'
export { evaluateGuardrail } from './evaluate'
export { GuardrailBlockedError } from './errors'
export { validateGuardrailRunResult } from './result-validation'
export { MEDIA_CLASSIFIER_PROMPT_VERSION } from './strategies/media-classifier'

// ── Types ──────────────────────────────────────────────────────────
export type {
  Guardrail,
  GuardrailConfig,
  GuardrailMode,
  GuardrailRunResult,
  GuardrailRewriteKind,
  GuardrailAudit,
  GuardrailAuditEntry,
  MediaGuardrailRunResult,
} from './types'
export type {
  MediaClassifierAction,
  MediaClassifierCategory,
  MediaClassifierModality,
  MediaClassifierOptions,
  MediaClassifierUnsupportedAction,
} from './strategies/media-classifier'
