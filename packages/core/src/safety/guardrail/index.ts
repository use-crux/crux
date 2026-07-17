// ── Authoring API (execution goes through the Safety session — see ../session) ──
export { guardrail, isGuardrail, getGuardrailDefinitionSource } from './define'
export { evaluateGuardrail } from './evaluate'
export { GuardrailBlockedError } from './errors'
export { validateGuardrailRunResult } from './types'

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
