// ── Authoring API (execution goes through the Safety session — see ../session) ──
export { guardrail, isGuardrail, getGuardrailDefinitionSource } from './define'
export { evaluateGuardrail } from './evaluate'
export { GuardrailBlockedError } from './errors'

// ── Types ──────────────────────────────────────────────────────────
export type {
  Guardrail,
  GuardrailConfig,
  GuardrailContext,
  GuardrailPhase,
  GuardrailStreamConfig,
  GuardrailResult,
  InputGuardrailResult,
  OutputGuardrailResult,
  ChunkGuardrailResult,
  GuardrailPass,
  GuardrailBlock,
  GuardrailRedact,
  GuardrailTransform,
  GuardrailWarn,
  GuardrailHold,
  GuardrailAudit,
  GuardrailAuditEntry,
} from './types'
