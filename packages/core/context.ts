import type { z } from 'zod'
import type {
  AnyToolSet,
  CacheOption,
  Context,
  ContextDef,
  ContextSystemContent,
  ContextSystemArg,
  ContextSystemResult,
  ContextTree,
  ConditionalContext,
  MatchSpec,
  DeepReadonly,
} from './types'
import { captureSource } from './project-index/source'

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
  /** Family label for observability grouping. Set by primitive factories; plain contexts omit it. */
  family?: import('./observability/contract').CruxContextInjectableKind
  /** Nested entries resolved before this context's own system text. */
  use?: readonly import('./types').ContextEntry[]
  /** Priority for token-aware rendering (0–100). Default: `50`. */
  priority?: number
  /** Static tools to contribute to prompts that `use` this context. */
  tools?: AnyToolSet
  /**
   * Predicate evaluated at resolve time. When false, context is excluded.
   * For static contexts, the predicate receives an empty input object.
   */
  when?: (arg: { input: {} }) => boolean
  /** Cache configuration. See `CacheOption` for details. */
  cache?: CacheOption
  /** Constraints contributed by this context. */
  constraints?: import('./safety/constraint/types').Constraint[]
  /** Guardrails contributed by this context. */
  guardrails?: import('./safety/guardrail/types').Guardrail[]
}

/** Default TTL (5 minutes) — matches Anthropic's cache window. */
const DEFAULT_CACHE_TTL = 300_000

/**
 * Read the `shape` property of a Zod schema (Zod v4 puts it on `_zod`, v3 on the root).
 * Returns `undefined` when the schema isn't an object schema.
 */
function readShape(schema: z.ZodType): Record<string, unknown> | undefined {
  const candidate = schema as { _zod?: { shape?: unknown }; shape?: unknown }
  const shape = candidate._zod?.shape ?? candidate.shape
  return shape && typeof shape === 'object' ? (shape as Record<string, unknown>) : undefined
}

function isContextSystemContent(value: unknown): value is ContextSystemContent {
  return typeof value === 'object' && value !== null && Array.isArray((value as { segments?: unknown }).segments)
}

/**
 * Parse a `CacheOption` into resolved `cacheTtl` and `providerCache` values.
 *
 * @param cache - The raw cache option from the context definition.
 * @param id - The context's id (for validation).
 * @param isStaticSystem - Whether the system is a plain string (not a function).
 * @returns Parsed `{ cacheTtl, providerCache }`.
 */
function parseCacheOption(
  cache: CacheOption | undefined,
  id: string | undefined,
  isStaticSystem: boolean,
): { cacheTtl: number; providerCache: boolean } {
  if (cache === undefined || cache === false) {
    return { cacheTtl: 0, providerCache: false }
  }

  if (cache === true) {
    return {
      cacheTtl: isStaticSystem ? 0 : DEFAULT_CACHE_TTL,
      providerCache: true,
    }
  }

  if (typeof cache === 'number') {
    return {
      cacheTtl: isStaticSystem ? 0 : cache,
      providerCache: true,
    }
  }

  // Object form: { ttl?, providerCache? }
  const ttl = cache.ttl !== undefined && cache.ttl > 0 && !isStaticSystem ? cache.ttl : 0
  // Default providerCache to true when cache object is provided
  const pc = cache.providerCache !== undefined ? cache.providerCache : true
  return { cacheTtl: ttl, providerCache: pc }
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

  // Extract input keys from the Zod schema shape (used for conflict detection)
  const inputKeys: string[] = []
  if (inputSchema) {
    const schemaShape = readShape(inputSchema)
    if (schemaShape) inputKeys.push(...Object.keys(schemaShape))
  }

  const systemFn: (input: Record<string, unknown>) => ContextSystemResult | Promise<ContextSystemResult> =
    typeof system === 'string'
      ? () => system
      : isContextSystemContent(system)
        ? () => system
        : (input) =>
            (system as (arg: ContextSystemArg<unknown>) => ContextSystemResult | Promise<ContextSystemResult>)({
              input,
            })

  const toolsValue: unknown = 'tools' in def ? def.tools : undefined
  const toolsFn: ((input: Record<string, unknown>) => AnyToolSet) | undefined =
    toolsValue === undefined
      ? undefined
      : typeof toolsValue === 'function'
        ? (input) => (toolsValue as (arg: ContextSystemArg<unknown>) => AnyToolSet)({ input })
        : () => toolsValue as AnyToolSet

  const rawFields: string[] = 'rawFields' in def && Array.isArray(def.rawFields) ? [...def.rawFields] : []

  // Process context-level `when` predicate
  const whenDef = 'when' in def ? (def as ContextDef<z.ZodType>).when : undefined
  const whenFn: ((input: Record<string, unknown>) => boolean) | undefined = whenDef
    ? (input) => whenDef({ input } as ContextSystemArg<unknown>)
    : undefined

  // Parse cache option
  const cacheRaw: CacheOption | undefined = 'cache' in def ? def.cache : undefined
  const { cacheTtl, providerCache } = parseCacheOption(
    cacheRaw,
    id,
    typeof system === 'string' || isContextSystemContent(system),
  )

  // Validate: cache TTL requires an id for cache key derivation
  if (cacheTtl > 0 && !id) {
    throw new Error(
      'context(): cache requires an id for cache key derivation. ' + 'Add an `id` field to your context definition.',
    )
  }

  const ctx = Object.freeze({
    _tag: 'Context' as const,
    id,
    description,
    inputSchema,
    inputKeys: Object.freeze(inputKeys),
    systemFn,
    systemKind: typeof system === 'string' || isContextSystemContent(system) ? 'static' : 'dynamic',
    useEntries: Object.freeze(useEntries),
    priority,
    toolsFn,
    rawFields: Object.freeze(rawFields),
    when: whenFn,
    cacheTtl,
    providerCache,
    constraints: Object.freeze([...('constraints' in def && Array.isArray(def.constraints) ? def.constraints : [])]),
    guardrails: Object.freeze([...('guardrails' in def && Array.isArray(def.guardrails) ? def.guardrails : [])]),
    family: 'family' in def ? def.family : undefined,
  })

  if (defSource) definitionSourceMap.set(ctx, defSource)

  return ctx
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
 * - By default, typed against the context's own input schema (full autocomplete).
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
  predicate: (
    input: TCtx extends Context<infer S>
      ? S extends z.ZodType
        ? z.infer<S>
        : Record<string, unknown>
      : Record<string, unknown>,
  ) => boolean,
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
export function match<
  TCases extends Record<string, Context<z.ZodType> | readonly Context<z.ZodType>[]>,
  TInput extends Record<string, unknown> = Record<string, unknown>,
>(opts: {
  on: (input: TInput) => Extract<keyof TCases, string>
  cases: TCases
  default?: Context<z.ZodType> | readonly Context<z.ZodType>[]
}): MatchSpec {
  const defSource = captureSource()

  const spec = Object.freeze({
    _tag: 'MatchSpec' as const,
    on: opts.on as (input: Record<string, unknown>) => string,
    cases: Object.freeze({ ...opts.cases }) as Readonly<
      Record<string, Context<z.ZodType> | readonly Context<z.ZodType>[]>
    >,
    default: opts.default,
  })

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

  function validate(node: unknown, path: string): void {
    if (node && typeof node === 'object' && '_tag' in node && (node as { _tag: unknown })._tag === 'Context') {
      all.push(node as Context<z.ZodType>)
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
