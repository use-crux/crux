import type { BoundaryDef, BoundaryInput } from '../boundary'
import { captureSource } from '../../project-index/source'
import type {
  Guardrail,
  GuardrailConfig,
} from './types'
import { classifier } from './strategies/classifier'
import { injection } from './strategies/injection'
import { media } from './strategies/media'
import { pii } from './strategies/pii'
import { secrets } from './strategies/secrets'

/** Module-scoped map: frozen guardrail -> definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a guardrail instance. */
export function getGuardrailDefinitionSource(
  guardrail: object,
): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(guardrail)
}

/**
 * Define a composable guardrail for a safety boundary.
 *
 * The `on` boundary drives the subject type passed to `run`. Text guardrails
 * stay generic-free, while object/path guardrails infer structured subjects.
 */
interface GuardrailFactory {
  <B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B>
  /** Built-in text PII redaction/masking/hash strategy. */
  readonly pii: typeof pii
  /** Built-in API key, token, and authorization redaction strategy. */
  readonly secrets: typeof secrets
  /** Built-in heuristic prompt-injection strategy. */
  readonly injection: typeof injection
  /** Provider-agnostic classifier strategy adapter. */
  readonly classifier: typeof classifier
  /** Build a declarative input-attachment policy callback. */
  readonly media: typeof media
}

function defineGuardrail<B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B>
function defineGuardrail<B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B> {
  const defSource = captureSource()
  const guard = defineBoundaryGuardrail(config)

  if (defSource) definitionSourceMap.set(guard, defSource)
  return guard
}

export const guardrail: GuardrailFactory = Object.assign(defineGuardrail, {
  pii,
  secrets,
  injection,
  classifier,
  media,
})

/** Runtime type guard: checks if a value is a Guardrail. */
export function isGuardrail(value: unknown): value is Guardrail {
  return (
    value !== null &&
    value !== undefined &&
    typeof value === 'object' &&
    '_tag' in value &&
    (value as { readonly _tag?: unknown })._tag === 'Guardrail'
  )
}

function defineBoundaryGuardrail<B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B> {
  const mode = config.mode ?? 'enforce'
  const strategy = strategyMetadata(config.run)

  const guard = Object.freeze({
    _tag: 'Guardrail' as const,
    id: config.id,
    on: config.on,
    category: config.category,
    mode,
    run: config.run,
    ...(strategy ? { strategy } : {}),
  }) satisfies Guardrail<B>

  return guard
}

function strategyMetadata(run: unknown): Guardrail['strategy'] | undefined {
  if (typeof run !== 'function') return undefined
  const maybeStrategy = (run as { readonly strategy?: unknown }).strategy
  return isStrategyMetadata(maybeStrategy) ? maybeStrategy : undefined
}

function isStrategyMetadata(value: unknown): value is NonNullable<Guardrail['strategy']> {
  return typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
}
