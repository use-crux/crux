import type { z } from 'zod'
import type {
  Context,
  ContextDef,
  ContextSystemContent,
  ContextSystemArg,
  ContextSystemResult,
  ContextTree,
  ConditionalContext,
  MatchSpec,
  MatchCases,
  ContextDefinitionWarning,
} from './context-types'
import type { DeepReadonly, InferContextInput } from './type-utils'
import type { AnyToolSet } from '../types'
import { captureSource } from '../project-index/source'
import type { CruxContextInjectableKind } from '../observability/contract'
import { getInputShapeKeys } from './schema-shape'
import { consumesFullPromptInput, withFullPromptInput } from './internal-full-input'

/** Module-scoped map: frozen context → definition-site source location. */
const definitionSourceMap = new WeakMap<object, { file: string; line: number; column?: number }>()

/** Retrieve the definition-site source location for a context instance. */
export function getContextDefinitionSource(ctx: object): { file: string; line: number; column?: number } | undefined {
  return definitionSourceMap.get(ctx)
}

/**
 * Union of every context leaf in a tree. Lets `tree._all[number]` narrow to
 * the actual context types declared by the user instead of the widened
 * `Context<z.ZodType>`.
 */
export type LeafContextOf<T> =
  T extends Context<z.ZodType>
    ? T
    : T extends Record<string, unknown>
      ? { [K in keyof T]: LeafContextOf<T[K]> }[keyof T]
      : never

/** The return type of `createContexts()` — a frozen tree with a hidden `_all` flat accessor. */
export type ContextTreeResult<T> = DeepReadonly<T> & { readonly _all: LeafContextOf<T>[] }

/** Static context config (no input schema). */
interface StaticContextDef {
  /** Unique identifier for introspection and debugging. */
  id?: string
  /** Human-readable description (surfaces in IDE hover). */
  description?: string
  /** Static system message text — always contributes the same content. */
  system: string | ContextSystemContent
  /** Nested entries resolved before this context's own system text. */
  use?: readonly import('./context-types').ContextEntry[]
  /** Priority for token-aware rendering (0–100). Default: `50`. */
  priority?: number
  /** Static tools to contribute to prompts that `use` this context. */
  tools?: AnyToolSet
  /**
   * Predicate evaluated at resolve time. When false, context is excluded.
   * For static contexts, the predicate receives an empty input object.
   */
  when?: (arg: { input: {} }) => boolean
  /** Provider cache hint: request a prompt-cache breakpoint for this block. Nothing app-side. */
  cache?: boolean
  /** Memoize this context's resolution app-side. Requires `id`. Dynamic `system` only. */
  memo?: { ttl: number }
  /** Constraints contributed by this context. */
  constraints?: import('../safety/constraint/types').Constraint[]
  /** Guardrails contributed by this context. */
  guardrails?: import('../safety/guardrail/types').Guardrail[]
}

/** Provider prompt-cache window used to detect contradictory short memo TTLs. */
const PROVIDER_CACHE_WINDOW_MS = 300_000
const contextFamilyMap = new WeakMap<object, CruxContextInjectableKind>()

function isContextSystemContent(value: unknown): value is ContextSystemContent {
  return typeof value === 'object' && value !== null && Array.isArray((value as { segments?: unknown }).segments)
}

function declaredInputFor(
  input: Record<string, unknown>,
  inputKeys: readonly string[],
  fullPromptInput: boolean,
): Record<string, unknown> {
  if (fullPromptInput) return input

  const declaredInput: Record<string, unknown> = {}
  for (const key of inputKeys) {
    declaredInput[key] = input[key]
  }
  return declaredInput
}

/**
 * Create a reusable typed context fragment.
 *
 * Contexts contribute to the system message of any prompt that references
 * them via `use`. They come in two forms:
 *
 * **Static** — always contributes the same system text:
 * ```ts
 * const rules = context({
 *   system: '## Rules\nAlways respond in JSON.',
 * })
 * ```
 *
 * **Dynamic** — declares input fields and conditionally contributes:
 * ```ts
 * const brand = context({
 *   input: z.object({ brandContext: z.string().optional() }),
 *   system: ({ input }) =>
 *     input.brandContext ? `## Brand\n${input.brandContext}` : '',
 * })
 * ```
 *
 * When a prompt `use`s a dynamic context, its input fields merge into
 * the prompt's required input type. Dynamic system functions that return
 * `''` are silently omitted from the assembled system message.
 *
 * @param def - Context configuration (static or dynamic).
 * @returns A frozen `Context` instance.
 */
export function context(def: StaticContextDef): Context<z.ZodType<{}>>
export function context<TInput extends z.ZodType>(def: ContextDef<TInput>): Context<TInput>
export function context(def: StaticContextDef | ContextDef<z.ZodType>): Context<z.ZodType> {
  const defSource = captureSource()
  const { id, description, system } = def
  const useEntries = 'use' in def && Array.isArray(def.use) ? [...def.use] : []
  const inputSchema = 'input' in def ? def.input : undefined
  const priority = 'priority' in def && def.priority !== undefined ? def.priority : 50
  const isStaticSystem = typeof system === 'string' || isContextSystemContent(system)
  const fullPromptInput = consumesFullPromptInput(def)

  // Extract input keys from the Zod schema shape (used for conflict detection)
  const inputKeys: string[] = []
  if (inputSchema) inputKeys.push(...getInputShapeKeys(inputSchema))

  const systemFn: (input: Record<string, unknown>) => ContextSystemResult | Promise<ContextSystemResult> =
    typeof system === 'string'
      ? () => system
      : isContextSystemContent(system)
        ? () => system
        : (input) =>
            (system as (arg: ContextSystemArg<unknown>) => ContextSystemResult | Promise<ContextSystemResult>)({
              input: declaredInputFor(input, inputKeys, fullPromptInput),
            })

  const toolsValue: unknown = 'tools' in def ? def.tools : undefined
  const toolsFn: ((input: Record<string, unknown>) => AnyToolSet) | undefined =
    toolsValue === undefined
      ? undefined
      : typeof toolsValue === 'function'
        ? (input) =>
            (toolsValue as (arg: ContextSystemArg<unknown>) => AnyToolSet)({
              input: declaredInputFor(input, inputKeys, fullPromptInput),
            })
        : () => toolsValue as AnyToolSet

  const rawFields: string[] = 'rawFields' in def && Array.isArray(def.rawFields) ? [...def.rawFields] : []

  // Process context-level `when` predicate
  const whenDef = 'when' in def ? (def as ContextDef<z.ZodType>).when : undefined
  const whenFn: ((input: Record<string, unknown>) => boolean) | undefined = whenDef
    ? (input) => whenDef({ input: declaredInputFor(input, inputKeys, fullPromptInput) } as ContextSystemArg<unknown>)
    : undefined

  const providerCache = 'cache' in def && def.cache === true
  const memoTtl = 'memo' in def && def.memo ? def.memo.ttl : 0

  if (memoTtl > 0 && !id) {
    throw new Error(
      'context(): memo requires an id for cache key derivation. ' + 'Add an `id` field to your context definition.',
    )
  }

  if (memoTtl > 0 && isStaticSystem) {
    throw new Error(
      `context(${id ?? 'unknown'}): memo has no effect on a static context — remove memo or make \`system\` a function.`,
    )
  }

  const definitionWarnings: ContextDefinitionWarning[] =
    providerCache && memoTtl > 0 && memoTtl < PROVIDER_CACHE_WINDOW_MS
      ? [
          {
            code: 'memo-cache-contradiction',
            message:
              `context "${id}": cache: true asks the provider to reuse this block for ~5 minutes, ` +
              `but memo.ttl (${memoTtl}ms) declares it stale sooner. ` +
              `Raise memo.ttl to ≥300000 or drop the provider cache hint.`,
          },
        ]
      : []

  const ctx = Object.freeze({
    _tag: 'Context' as const,
    id,
    description,
    inputSchema,
    inputKeys: Object.freeze(inputKeys),
    systemFn,
    systemKind: isStaticSystem ? 'static' : 'dynamic',
    useEntries: Object.freeze(useEntries),
    priority,
    toolsFn,
    rawFields: Object.freeze(rawFields),
    when: whenFn,
    memoTtl,
    providerCache,
    definitionWarnings: Object.freeze(definitionWarnings),
    constraints: Object.freeze([...('constraints' in def && Array.isArray(def.constraints) ? def.constraints : [])]),
    guardrails: Object.freeze([...('guardrails' in def && Array.isArray(def.guardrails) ? def.guardrails : [])]),
    family: contextFamilyMap.get(def),
  })

  if (defSource) definitionSourceMap.set(ctx, defSource)

  return ctx
}

/**
 * @internal Create an SDK-owned adapter context whose callback consumes the
 * full prompt input contractually (for example, dynamic memory namespaces or
 * retriever query callbacks). Application-authored contexts should use
 * `context()` with an explicit `input` schema instead.
 */
export function contextWithFullPromptInput(
  def: Omit<ContextDef<z.ZodType<Record<string, unknown>>>, 'input' | 'rawFields' | 'memo'>,
  family?: CruxContextInjectableKind,
): Context<z.ZodType<{}>> {
  const fullInputDef = withFullPromptInput(def)
  if (family) contextFamilyMap.set(fullInputDef, family)
  return context(fullInputDef) as Context<z.ZodType<{}>>
}

/**
 * @internal Create a context with a first-party observability family.
 *
 * Application-authored `ContextDef` objects do not expose `family`; primitive
 * factories use this helper so resolved contexts can still be attributed as
 * memory, blackboard, retriever, skill, and similar built-ins.
 */
export function contextWithFamily<TInput extends z.ZodType>(
  def: ContextDef<TInput>,
  family: CruxContextInjectableKind,
): Context<TInput>
export function contextWithFamily(def: StaticContextDef, family: CruxContextInjectableKind): Context<z.ZodType<{}>>
export function contextWithFamily(
  def: StaticContextDef | ContextDef<z.ZodType>,
  family: CruxContextInjectableKind,
): Context<z.ZodType> {
  contextFamilyMap.set(def, family)
  const createContext = context as (contextDef: StaticContextDef | ContextDef<z.ZodType>) => Context<z.ZodType>
  return createContext(def)
}

// ─────────────────────────────────────────────────────────────────
// Conditional Context Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * Wrap a context with a runtime predicate for conditional inclusion.
 *
 * When the predicate returns `false` at resolve time, the context is
 * excluded entirely — no `systemFn`, no tools, no token counting.
 * The wrapped context's input keys become `Partial<>` in the merged type.
 *
 * **Predicate typing:**
 * - By default, typed against a partial view of the context's own input schema.
 * - For prompt-level fields not on the context, use an explicit generic:
 *   `when<{ mode: string }>(i => i.mode === 'research', ctx)`
 *
 * @example
 * ```ts
 * prompt({
 *   use: [
 *     when(i => !!i.brandVoice, brandCtx),           // typed from brandCtx's input
 *     when<{ mode: string }>(i => i.mode === 'edit', editCtx), // explicit generic
 *   ],
 * })
 * ```
 */
export function when<TCtx extends Context<z.ZodType>>(
  predicate: (input: Partial<InferContextInput<TCtx>> & Record<string, unknown>) => boolean,
  ctx: TCtx,
): ConditionalContext<TCtx>
export function when<TInput extends Record<string, unknown>, TCtx extends Context<z.ZodType> = Context<z.ZodType>>(
  predicate: (input: TInput) => boolean,
  ctx: TCtx,
): ConditionalContext<TCtx>
export function when(
  predicate: (input: Record<string, unknown>) => boolean,
  ctx: Context<z.ZodType>,
): ConditionalContext<Context<z.ZodType>> {
  const defSource = captureSource()

  const wrapped = Object.freeze({
    _tag: 'ConditionalContext' as const,
    context: ctx,
    predicate: predicate as (input: Record<string, unknown>) => boolean,
  })

  if (defSource) definitionSourceMap.set(wrapped, defSource)

  return wrapped
}

/**
 * Select contexts based on a discriminator value derived from input.
 *
 * Only the matching branch's context(s) are resolved. All other branches
 * are excluded entirely (no systemFn, no tools). If no case matches and
 * no default is provided, no contexts are included from this spec.
 *
 * @example
 * ```ts
 * prompt({
 *   use: [
 *     match({
 *       on: (input) => input.mode,
 *       cases: {
 *         research: researchCtx,
 *         create: createCtx,
 *         optimize: [optimizeCtx, seoCtx],
 *       },
 *       default: createCtx,
 *     }),
 *   ],
 *   input: z.object({ mode: z.string() }),
 * })
 * ```
 */
export function match<const TCases extends MatchCases>(opts: {
  on: () => Extract<keyof TCases, string>
  cases: TCases
  default?: Context<z.ZodType> | readonly Context<z.ZodType>[]
}): MatchSpec<TCases>
export function match<
  const TCases extends MatchCases,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(opts: {
  on: (input: TInput) => Extract<keyof TCases, string>
  cases: TCases
  default?: Context<z.ZodType> | readonly Context<z.ZodType>[]
}): MatchSpec<TCases>
export function match(opts: {
  on: (input: Record<string, unknown>) => string
  cases: MatchCases
  default?: Context<z.ZodType> | readonly Context<z.ZodType>[]
}): MatchSpec<MatchCases> {
  const defSource = captureSource()

  const spec = Object.freeze({
    _tag: 'MatchSpec' as const,
    on: opts.on as (input: Record<string, unknown>) => string,
    cases: Object.freeze({ ...opts.cases }),
    default: opts.default,
  }) satisfies MatchSpec<MatchCases>

  if (defSource) definitionSourceMap.set(spec, defSource)

  return spec
}

/**
 * Organize contexts into a nested, frozen tree with full type inference.
 *
 * Inspired by AI SDK's `createProviderRegistry()` — a typed const object
 * where IDE autocomplete shows everything available at each nesting level.
 *
 * ```ts
 * const ctx = createContexts({
 *   editor: {
 *     proseMirror: context({ system: '...' }),
 *     instructions: context({ system: '...' }),
 *   },
 *   brand: {
 *     voice: context({ input: z.object({...}), system: ({input}) => '...' }),
 *   },
 *   language: context({ input: z.object({...}), system: ({input}) => '...' }),
 * })
 *
 * // Nested autocomplete: ctx.editor. → proseMirror, instructions
 * prompt({ use: [ctx.editor.proseMirror, ctx.brand.voice] })
 * ```
 *
 * All leaf values must be `Context` instances (fails fast on typos).
 * The returned tree is deep-frozen and fully readonly.
 *
 * Also exposes a non-enumerable `_all` property containing a flat array
 * of every `Context` in the tree, for passing to `configure()`.
 *
 * @param tree - Nested object of contexts and context groups.
 * @returns A deep-frozen tree with `_all` flat accessor.
 */
export function createContexts<const T extends ContextTree>(tree: T): ContextTreeResult<T> {
  const all: Context<z.ZodType>[] = []
  const seenIds = new Map<string, string>()

  function validate(node: unknown, path: string): void {
    if (node && typeof node === 'object' && '_tag' in node && (node as { _tag: unknown })._tag === 'Context') {
      const ctx = node as Context<z.ZodType>
      if (ctx.id) {
        const existingPath = seenIds.get(ctx.id)
        if (existingPath) {
          throw new Error(`createContexts: duplicate context id "${ctx.id}" at "${existingPath}" and "${path}".`)
        }
        seenIds.set(ctx.id, path)
      }
      all.push(ctx)
      return
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        validate(value, path ? `${path}.${key}` : key)
      }
      return
    }
    throw new Error(`createContexts: invalid value at "${path}" — expected Context or nested object`)
  }

  validate(tree, '')

  function deepFreeze<O extends object>(obj: O): O {
    Object.freeze(obj)
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        deepFreeze(value as object)
      }
    }
    return obj
  }

  const result = { ...tree }
  Object.defineProperty(result, '_all', {
    value: Object.freeze(all),
    enumerable: false,
    configurable: false,
    writable: false,
  })

  return deepFreeze(result) as ContextTreeResult<T>
}
