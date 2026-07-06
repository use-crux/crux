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
import { validateGuardrailRunResult } from './types'

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
export function guardrail<B extends BoundaryInput>(config: GuardrailConfig<B>): Guardrail<B>
/** @internal Transitional overload for pre-migration source files. */
export function guardrail<TPhase extends GuardrailPhase>(config: LegacyGuardrailConfig<TPhase>): Guardrail<BoundaryDef>
export function guardrail<B extends BoundaryInput>(
  config: GuardrailConfig<B> | LegacyGuardrailConfig,
): Guardrail<B> | Guardrail<BoundaryDef> {
  const defSource = captureSource()
  const guard = isLegacyGuardrailConfig(config) ? defineLegacyGuardrail(config) : defineBoundaryGuardrail(config)

  if (defSource) definitionSourceMap.set(guard, defSource)
  return guard
}

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

  const guard = Object.freeze({
    _tag: 'Guardrail' as const,
    id: config.id,
    on: config.on,
    category: config.category,
    mode,
    stream: config.stream,
    run: config.run,
    ...(strategy ? { strategy } : {}),
    name: config.id,
    phase,
    validate: async (content: string, ctx: GuardrailContext): Promise<GuardrailResult<GuardrailPhase>> => {
      const primaryBoundary = firstBoundary(config.on)
      const runCtx = contextForGuard(config.id, mode, primaryBoundary, ctx)
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

function defineLegacyGuardrail<TPhase extends GuardrailPhase>(
  config: LegacyGuardrailConfig<TPhase>,
): Guardrail<BoundaryDef> {
  const on = config.phase === 'input' ? boundary.input.text() : boundary.output.text()
  return Object.freeze({
    _tag: 'Guardrail' as const,
    id: config.name,
    on,
    category: config.category,
    mode: 'enforce' as const,
    stream: config.stream,
    run: async (subject: unknown): Promise<GuardrailRunResult<string>> => {
      const result = await config.validate(String(subject), legacyContext(config.phase))
      return fromLegacyGuardrailResult(result)
    },
    name: config.name,
    phase: config.phase,
    validate: config.validate as Guardrail<BoundaryDef>['validate'],
    onChunk: config.onChunk,
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
