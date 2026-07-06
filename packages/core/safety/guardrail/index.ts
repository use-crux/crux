// ── Authoring API (execution goes through the Safety session — see ../session) ──
export { guardrail, isGuardrail, getGuardrailDefinitionSource } from './define'
export { evaluateGuardrail } from './evaluate'
export { GuardrailBlockedError } from './errors'
export { validateGuardrailRunResult } from './types'

// ── Types ──────────────────────────────────────────────────────────
export type {
  Guardrail,
  GuardrailConfig,
  GuardrailContext,
  GuardrailPhase,
  GuardrailMode,
  GuardrailStreamConfig,
  GuardrailResult,
  GuardrailRunResult,
  GuardrailRewriteKind,
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
