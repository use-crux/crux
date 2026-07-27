/**
 * Provider-visible tool-definition boundaries.
 *
 * Tool boundaries govern what a model is told exists. They do not govern tool
 * execution; use `toolPolicy()` for call and result behavior.
 *
 * @module
 */

import type { BoundaryDef } from './boundary'

/** Provenance classes for provider-visible tool definitions. */
export type ToolDefinitionSource = 'authored' | 'discovered'

/**
 * Privacy-safe provider-visible tool definition supplied to a root tool
 * guardrail.
 *
 * @remarks
 * The subject never includes execution functions, validators, provider
 * objects, or source adapters.
 */
export interface ToolDefinitionSubject {
  /** Canonical provider-visible tool name. */
  readonly name: string
  /** Canonical provider-visible tool description. */
  readonly description: string
  /** Canonical recursively frozen JSON Schema exposed to the provider. */
  readonly parameters: Readonly<Record<string, unknown>>
}

/** Privacy-safe provenance supplied for provider-visible tool definitions. */
export type ToolDefinitionOrigin =
  | {
      /** Identifies tool-definition model ingress. */
      readonly source: 'tool-definition'
      /** Indicates a tool supplied directly by the prompt or call site. */
      readonly kind: 'authored'
      /** Canonical provider-visible tool name. */
      readonly toolName: string
    }
  | {
      /** Identifies tool-definition model ingress. */
      readonly source: 'tool-definition'
      /** Indicates a tool materialized by runtime discovery. */
      readonly kind: 'discovered'
      /** Canonical provider-visible tool name. */
      readonly toolName: string
      /** Stable identifier of the winning discovery source. */
      readonly sourceId: string
      /** Stable kind of the winning discovery source. */
      readonly sourceKind: string
    }

/**
 * Privacy-safe provenance for a provider-visible description string.
 *
 * The runtime retains an exact private schema path only while applying a
 * rewrite. Public policy context exposes the description category and depth,
 * never a schema property name or path.
 */
export type ToolDescriptionOrigin = ToolDefinitionOrigin & {
  /** Distinguishes the root tool description from a schema annotation. */
  readonly descriptionKind: 'tool' | 'schema'
  /** Zero-based schema nesting depth for schema annotations. */
  readonly schemaDepth?: number
}

interface ToolDefinitionBoundaryOptions {
  /**
   * One source, or a non-empty source tuple, to match.
   *
   * @default Both `authored` and `discovered`.
   */
  readonly from?: ToolDefinitionSource | readonly ToolDefinitionSource[]
}

type ToolSourcesFromOptions<TOptions> = TOptions extends {
  readonly from: infer TSelection
}
  ? TSelection extends readonly (infer TSource)[]
    ? Extract<TSource, ToolDefinitionSource>
    : Extract<TSelection, ToolDefinitionSource>
  : ToolDefinitionSource

type NonEmptyToolDefinitionOptions<TOptions> = TOptions extends {
  readonly from: readonly []
}
  ? never
  : TOptions

type ToolDefinitionOriginFor<TSource extends ToolDefinitionSource> = Extract<
  ToolDefinitionOrigin,
  { readonly kind: TSource }
>

type ToolDescriptionOriginFor<TSource extends ToolDefinitionSource> = Extract<
  ToolDescriptionOrigin,
  { readonly kind: TSource }
>

type ToolDescriptionBoundary<TSource extends ToolDefinitionSource> = BoundaryDef<
  'model.input.tools',
  string,
  ToolDescriptionOriginFor<TSource>
> & {
  readonly selector: 'descriptions'
}

type ToolDefinitionBoundary<TSource extends ToolDefinitionSource> = BoundaryDef<
  'model.input.tools',
  ToolDefinitionSubject,
  ToolDefinitionOriginFor<TSource>
> & {
  /**
   * Target provider-visible tool and JSON Schema description strings.
   *
   * @returns A frozen closed-text boundary retaining this source filter.
   */
  descriptions(): ToolDescriptionBoundary<TSource>
}

const TOOL_SOURCES = ['authored', 'discovered'] as const

/**
 * Target canonical tool definitions immediately before provider exposure.
 *
 * @remarks
 * Enforcing `strip` removes the tool from provider exposure and executable
 * registration. Enforcing `block` stops the call. Report mode records either
 * intent without changing the exposed tool set.
 *
 * @param options - Optional authored/discovered provenance filter.
 * @returns A frozen, serializable tool-definition boundary.
 * @throws {TypeError} When `from` is empty or contains an unsupported source.
 *
 * @example
 * ```ts
 * const discoveredTools = guardrail({
 *   id: 'discovered-tools',
 *   on: boundary.input.tools({ from: 'discovered' }),
 *   run: (tool) =>
 *     tool.name.startsWith('public_')
 *       ? { action: 'allow' }
 *       : { action: 'strip', reason: 'Only public tools may be exposed.' },
 * })
 * ```
 *
 * @example
 * ```ts
 * const toolDescriptions = guardrail({
 *   id: 'tool-descriptions',
 *   on: boundary.input.tools().descriptions(),
 *   run: (description) => ({
 *     action: 'rewrite',
 *     value: description.replaceAll('internal', 'available'),
 *     rewrite: { kind: 'normalize' },
 *   }),
 * })
 * ```
 */
export function inputTools<
  const TOptions extends ToolDefinitionBoundaryOptions =
    ToolDefinitionBoundaryOptions,
>(
  options?: NonEmptyToolDefinitionOptions<TOptions>,
): ToolDefinitionBoundary<ToolSourcesFromOptions<TOptions>> {
  const from = normalizeToolSources(options?.from)
  const data =
    from === undefined
      ? { _tag: 'Boundary' as const, id: 'model.input.tools' as const }
      : { _tag: 'Boundary' as const, id: 'model.input.tools' as const, from }
  return freezeToolBoundary(data, {
    descriptions: () =>
      freezeToolBoundary({
        ...data,
        selector: 'descriptions',
      }),
  })
}

function freezeToolBoundary<TBoundary>(
  data: Readonly<Record<string, unknown>>,
  methods?: Readonly<Record<string, unknown>>,
): TBoundary {
  const target: Record<string, unknown> = { ...data }
  for (const [key, value] of Object.entries(methods ?? {})) {
    Object.defineProperty(target, key, {
      value,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
  return Object.freeze(target) as TBoundary
}

function normalizeToolSources(
  selected: ToolDefinitionSource | readonly ToolDefinitionSource[] | undefined,
): readonly ToolDefinitionSource[] | undefined {
  if (selected === undefined) return undefined
  const values = Array.isArray(selected) ? selected : [selected]
  if (values.length === 0) {
    throw new TypeError('Tool definition source filters cannot be empty.')
  }
  const normalized = [...new Set(values)]
  for (const source of normalized) {
    if (!TOOL_SOURCES.includes(source)) {
      throw new TypeError(`Unsupported tool definition source: ${String(source)}`)
    }
  }
  return Object.freeze(normalized)
}
