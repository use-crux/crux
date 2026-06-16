import type { GuardrailConfig, GuardrailPhase, Guardrail } from './types'
import { captureSource } from '../../project-index/source'

/** Module-scoped map: frozen guardrail → definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a guardrail instance. */
export function getGuardrailDefinitionSource(
  guardrail: object,
): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(guardrail)
}

/**
 * Define a composable guardrail for I/O safety validation.
 *
 * Guards are frozen objects — define once, compose into pipelines.
 * Guardrails filter content (block, redact, transform, warn) but never re-call the model.
 * For retry-with-feedback on output quality, use `constraint()` instead.
 */
export function guardrail<TPhase extends GuardrailPhase>(config: GuardrailConfig<TPhase>): Guardrail<TPhase> {
  // Capture call-site for devtools source map resolution
  const defSource = captureSource()

  const guardrail = Object.freeze({
    _tag: 'Guardrail' as const,
    name: config.name,
    category: config.category,
    phase: config.phase,
    validate: config.validate,
    stream: config.stream,
    onChunk: config.onChunk,
  }) satisfies Guardrail<TPhase>

  // Store definition-site source in WeakMap (frozen objects can't have properties added)
  if (defSource) definitionSourceMap.set(guardrail, defSource)

  return guardrail
}

/** Runtime type guard: checks if a value is a Guardrail. */
export function isGuardrail(value: unknown): value is Guardrail {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    '_tag' in value &&
    (value as { _tag: unknown })._tag === 'Guardrail'
  )
}
