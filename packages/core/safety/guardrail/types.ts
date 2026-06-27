import type { Message } from '../../generation/messages'

// ── Phase ──────────────────────────────────────────────────────────

export type GuardrailPhase = 'input' | 'output'

// ── Context ────────────────────────────────────────────────────────

export interface GuardrailContext {
  readonly phase: GuardrailPhase
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly messages: readonly Message[]
  readonly systemPrompt: string | undefined
  readonly traceId: string | undefined
  readonly metadata: Readonly<Record<string, unknown>>
}

// ── Stream Config ──────────────────────────────────────────────────

export interface GuardrailStreamConfig {
  readonly buffer: 'none' | 'full'
}

// ── Result Types (phase-dependent) ─────────────────────────────────

/** Result when content passes without modification. */
export interface GuardrailPass {
  readonly action: 'pass'
}

/** Result when content is blocked (hard stop). */
export interface GuardrailBlock {
  readonly action: 'block'
  readonly reason: string
}

/** Result when content is redacted (destructive safety removal). */
export interface GuardrailRedact {
  readonly action: 'redact'
  readonly content: string
  readonly entities?: readonly unknown[]
}

/** Result when content is transformed (constructive quality improvement). */
export interface GuardrailTransform {
  readonly action: 'transform'
  readonly content: string
}

/** Result when a warning is logged but content continues. */
export interface GuardrailWarn {
  readonly action: 'warn'
  readonly reason: string
}

/** Actions available on input guards. */
export type InputGuardrailResult = GuardrailPass | GuardrailBlock | GuardrailRedact | GuardrailTransform | GuardrailWarn

/** Actions available on output guards. */
export type OutputGuardrailResult = GuardrailPass | GuardrailBlock | GuardrailRedact | GuardrailTransform | GuardrailWarn

/** Result when the guard needs more data — holds this chunk and merges it into the next. */
export interface GuardrailHold {
  readonly action: 'hold'
}

/** Actions available on streaming chunk handlers. */
export type ChunkGuardrailResult =
  | GuardrailPass
  | GuardrailBlock
  | GuardrailRedact
  | GuardrailTransform
  | GuardrailWarn
  | GuardrailHold

/** Phase-conditional result type. Input and output guards share the same action set. */
export type GuardrailResult<TPhase extends GuardrailPhase> = TPhase extends 'input'
  ? InputGuardrailResult
  : OutputGuardrailResult

// ── Config ─────────────────────────────────────────────────────────

export interface GuardrailConfig<TPhase extends GuardrailPhase = GuardrailPhase> {
  readonly name: string
  /**
   * Optional risk-category label (e.g. `'pii'`, `'jailbreak'`, `'toxicity'`).
   * Carried through audit entries and observability artifacts so devtools
   * and reporting can aggregate by risk type instead of by policy name.
   */
  readonly category?: string
  readonly phase: TPhase
  readonly validate: (content: string, context: GuardrailContext) => Promise<GuardrailResult<TPhase>>
  readonly stream?: GuardrailStreamConfig
  readonly onChunk?: (chunk: string, accumulated: string, context: GuardrailContext) => Promise<ChunkGuardrailResult>
}

// ── Frozen Guardrail Object ────────────────────────────────────────

export interface Guardrail<TPhase extends GuardrailPhase = GuardrailPhase> {
  readonly _tag: 'Guardrail'
  readonly name: string
  readonly category: string | undefined
  readonly phase: TPhase
  readonly validate: (content: string, context: GuardrailContext) => Promise<GuardrailResult<TPhase>>
  readonly stream: GuardrailStreamConfig | undefined
  readonly onChunk:
    | ((chunk: string, accumulated: string, context: GuardrailContext) => Promise<ChunkGuardrailResult>)
    | undefined
}

// ── Audit ──────────────────────────────────────────────────────────

export interface GuardrailAuditEntry {
  readonly guard: string
  readonly category?: string
  readonly phase: GuardrailPhase
  readonly action: string
  readonly original?: string
  readonly durationMs: number
}

export interface GuardrailAudit {
  readonly applied: readonly GuardrailAuditEntry[]
  readonly blocked: boolean
}
