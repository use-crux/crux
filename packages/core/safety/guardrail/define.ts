import type { BoundaryDef, BoundaryInput } from '../boundary'
import { boundary } from '../boundary'
import type { SafetyRunContext } from '../decision'
import { captureSource } from '../../project-index/source'
import type {
  Guardrail,
  GuardrailConfig,
  GuardrailContext,
  GuardrailPhase,
  GuardrailResult,
  GuardrailRunResult,
  LegacyGuardrailConfig,
} from './types'
import { validateGuardrailRunResult, validateLegacyGuardrailResult } from './types'
import { classifier } from './strategies/classifier'
import { injection } from './strategies/injection'
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
  /** @internal Transitional overload for pre-migration source files. */
  <TPhase extends GuardrailPhase>(config: LegacyGuardrailConfig<TPhase>): Guardrail<BoundaryDef>
  /** Built-in text PII redaction/masking/hash strategy. */
  readonly pii: typeof pii
  /** Built-in API key, token, and authorization redaction strategy. */
  readonly secrets: typeof secrets
  /** Built-in heuristic prompt-injection strategy. */
  readonly injection: typeof injection
  /** Provider-agnostic classifier strategy adapter. */
  readonly classifier: typeof classifier
}

function defineGuardrail<B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B>
function defineGuardrail<TPhase extends GuardrailPhase>(config: LegacyGuardrailConfig<TPhase>): Guardrail<BoundaryDef>
function defineGuardrail<B extends BoundaryInput>(
  config: GuardrailConfig<B> | LegacyGuardrailConfig,
): Guardrail<B> | Guardrail<BoundaryDef> {
  const defSource = captureSource()
  const guard = isLegacyGuardrailConfig(config) ? defineLegacyGuardrail(config) : defineBoundaryGuardrail(config)

  if (defSource) definitionSourceMap.set(guard, defSource)
  return guard
}

export const guardrail: GuardrailFactory = Object.assign(defineGuardrail, {
  pii,
  secrets,
  injection,
  classifier,
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
  const phase = phaseForBoundaryInput(config.on)
  const strategy = strategyMetadata(config.run)
  const stream = config.stream ?? defaultStreamForStrategy(strategy)

  const guard = Object.freeze({
    _tag: 'Guardrail' as const,
    authoring: 'boundary' as const,
    id: config.id,
    on: config.on,
    category: config.category,
    mode,
    stream,
    run: config.run,
    ...(strategy ? { strategy } : {}),
    name: config.id,
    phase,
    validate: async (content: string, ctx: GuardrailContext): Promise<GuardrailResult<GuardrailPhase>> => {
      const primaryBoundary = firstBoundary(config.on)
      const runCtx = contextForGuard(config.id, ctx.mode ?? mode, primaryBoundary, ctx)
      const result = validateGuardrailRunResult(await config.run(content as never, runCtx as never), {
        streaming: false,
        last: true,
        policyId: config.id,
        boundary: primaryBoundary.id,
      })
      return toLegacyGuardrailResult(result)
    },
    onChunk: undefined,
  }) satisfies Guardrail<B>

  return guard
}

function defaultStreamForStrategy(strategy: Guardrail['strategy'] | undefined): Guardrail['stream'] {
  switch (strategy?.kind) {
    case 'guardrail.pii':
    case 'guardrail.secrets':
    case 'guardrail.injection':
      return 'sentence'
    case 'guardrail.classifier':
      return 'final'
    default:
      return undefined
  }
}

function defineLegacyGuardrail<TPhase extends GuardrailPhase>(
  config: LegacyGuardrailConfig<TPhase>,
): Guardrail<BoundaryDef> {
  const on = config.phase === 'input' ? boundary.input.text() : boundary.output.text()
  return Object.freeze({
    _tag: 'Guardrail' as const,
    authoring: 'legacy' as const,
    id: config.name,
    on,
    category: config.category,
    mode: 'enforce' as const,
    stream: config.stream,
    run: async (subject: unknown): Promise<GuardrailRunResult<string>> => {
      const result = validateLegacyGuardrailResult(await config.validate(String(subject), legacyContext(config.phase)), {
        streaming: false,
        last: true,
        policyId: config.name,
        boundary: on.id,
      }) as GuardrailResult<TPhase>
      return fromLegacyGuardrailResult(result)
    },
    name: config.name,
    phase: config.phase,
    validate: async (content: string, context: GuardrailContext) =>
      validateLegacyGuardrailResult(await config.validate(content, context), {
        streaming: false,
        last: true,
        policyId: config.name,
        boundary: on.id,
      }) as GuardrailResult<TPhase>,
    onChunk: config.onChunk
      ? async (chunk: string, accumulated: string, context: GuardrailContext) =>
          validateLegacyGuardrailResult(await config.onChunk!(chunk, accumulated, context), {
            streaming: true,
            last: false,
            policyId: config.name,
            boundary: on.id,
          }) as Awaited<ReturnType<NonNullable<Guardrail<BoundaryDef>['onChunk']>>>
      : undefined,
  }) satisfies Guardrail<BoundaryDef>
}

function isLegacyGuardrailConfig(value: unknown): value is LegacyGuardrailConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'phase' in value &&
    'validate' in value
  )
}

function firstBoundary(input: BoundaryInput): BoundaryDef {
  return isBoundaryArray(input) ? input[0] ?? boundary.output.text() : input
}

function phaseForBoundaryInput(input: BoundaryInput): GuardrailPhase {
  const entries: readonly BoundaryDef[] = isBoundaryArray(input) ? input : [input]
  return entries.some((entry) => entry.id === 'user.input' || entry.id === 'model.input') ? 'input' : 'output'
}

function isBoundaryArray(input: BoundaryInput): input is readonly BoundaryDef[] {
  return Array.isArray(input)
}

function strategyMetadata(run: unknown): Guardrail['strategy'] | undefined {
  if (typeof run !== 'function') return undefined
  const maybeStrategy = (run as { readonly strategy?: unknown }).strategy
  return isStrategyMetadata(maybeStrategy) ? maybeStrategy : undefined
}

function isStrategyMetadata(value: unknown): value is NonNullable<Guardrail['strategy']> {
  return typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
}

function contextForGuard<B extends BoundaryDef>(
  id: string,
  mode: 'enforce' | 'report',
  on: B,
  ctx: GuardrailContext,
): SafetyRunContext<B> {
  return {
    policy: { id, mode },
    boundary: { id: on.id as never, kind: on.id as never },
    prompt: { id: ctx.promptId },
    model: { id: ctx.model },
    trace: { id: ctx.traceId },
    attempt: { index: 0, kind: 'initial' },
    metadata: ctx.metadata,
    findings: { add() {} },
    ...(ctx.stream ? { stream: ctx.stream } : {}),
    ...(on.path ? { path: on.path } : {}),
  }
}

function toLegacyGuardrailResult(result: GuardrailRunResult<unknown>): GuardrailResult<GuardrailPhase> {
  switch (result.action) {
    case 'allow':
      return { action: 'pass' }
    case 'block':
      return { action: 'block', reason: result.reason }
    case 'warn':
      return { action: 'warn', reason: result.reason }
    case 'rewrite': {
      const content = stringifyGuardrailValue(result.value)
      return result.rewrite.kind === 'normalize'
        ? { action: 'transform', content }
        : { action: 'redact', content }
    }
    case 'hold':
      throw new Error('Unexpected stream hold from non-stream guardrail validation.')
  }
}

function fromLegacyGuardrailResult(result: GuardrailResult<GuardrailPhase>): GuardrailRunResult<string> {
  switch (result.action) {
    case 'pass':
      return { action: 'allow' }
    case 'block':
      return { action: 'block', reason: result.reason }
    case 'warn':
      return { action: 'warn', reason: result.reason }
    case 'redact':
      return { action: 'rewrite', value: result.content, rewrite: { kind: 'redact' } }
    case 'transform':
      return { action: 'rewrite', value: result.content, rewrite: { kind: 'normalize' } }
  }
}

function stringifyGuardrailValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function legacyContext(phase: GuardrailPhase): GuardrailContext {
  return {
    phase,
    promptId: undefined,
    model: undefined,
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
  }
}
