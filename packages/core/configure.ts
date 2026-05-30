/**
 * Central configuration for the prompt system.
 *
 * `configure()` replaces scattered global setter calls with a single
 * configuration point. It accepts prompt/context trees (from `createPrompts`/
 * `createContexts`) or flat arrays, sets up devtools, middleware, tokenizer,
 * and returns a frozen config object with registry methods.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyPrompt, Context, Prompt, PromptMiddleware, ContextTree } from './types'
import type { TokenizerFn } from './tokenizer'
import type { PromptTree } from './prompts-tree'
import type { FlowToolDef } from './testing'
import type { CruxPlugin } from './plugin'
import type { RuntimeBridgeOptions } from './runtime-bridge'
import { setTokenizer } from './tokenizer'
import { getRuntime, setRuntime, resetRuntime } from './runtime'
import { applyPlugins } from './plugin'
import { withDevtools } from './observability'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/**
 * Accepts a PromptTree, the frozen result of createPrompts(), or a flat array.
 * Uses `Record<string, unknown>` for tree inputs because PromptTreeResult
 * includes a non-enumerable `_all` that breaks strict index signatures.
 */
type PromptInput = AnyPrompt[] | Record<string, unknown>
/** Accepts a ContextTree, the frozen result of createContexts(), or a flat array. */
type ContextInput = Context<z.ZodType>[] | Record<string, unknown>

export interface ConfigureOptions {
  /**
   * Prompts to register. Accepts a tree from `createPrompts()` or a flat array.
   * If a tree is passed, namespace paths are computed for devtools display.
   */
  prompts: PromptInput

  /**
   * Contexts to register. Accepts a tree from `createContexts()` or a flat array.
   * Optional — contexts referenced via prompts' `use` arrays are auto-collected.
   * If a tree is passed, namespace paths are computed for devtools display.
   */
  contexts?: ContextInput

  /** Devtools configuration. Devtools are enabled when `serverUrl` is truthy. */
  devtools?: {
    /**
     * URL of the devtools server. When truthy, devtools instrumentation is enabled.
     * Accepts http://, https://, ws://, or wss:// — automatically normalized.
     * @default 'http://localhost:4400'
     */
    serverUrl?: string
    /**
     * Enable the Runtime Bridge command plane.
     *
     * `true` uses the core default WS peer for long-lived local Node runtimes.
     * Framework integrations such as `@crux/convex` can register HTTP bridge
     * endpoints from their setup helpers. Explicit bridge config wins.
     */
    bridge?: RuntimeBridgeOptions
  }

  /** Global middleware wrapping every adapter `generate()` call. */
  middleware?: PromptMiddleware

  /** Custom tokenizer function for token counting. */
  tokenizer?: TokenizerFn

  /**
   * Auto-escape all string input values before they reach system/prompt functions.
   * Enabled by default. Set to `false` to disable (e.g., when using `safe` tag exclusively).
   * @default true
   */
  autoEscape?: boolean

  /**
   * Log `console.warn()` when input fields contain suspicious patterns
   * (XML closing tags, instruction overrides, prompt extraction attempts).
   * Defaults to `true` in development (NODE_ENV !== 'production'), `false` in production.
   * Set explicitly to override the default.
   */
  securityWarnings?: boolean

  /** Tool definitions to register in the devtools catalog. */
  tools?: FlowToolDef[]

  /**
   * Plugins to install. Processed in order — each plugin's `install()`
   * receives the cumulative runtime from all prior plugins.
   * Plugins are applied after middleware and devtools setup.
   */
  plugins?: CruxPlugin[]
}

export interface PromptRegistry {
  /** All registered prompts (flat). */
  readonly prompts: readonly AnyPrompt[]
  /** All registered contexts (flat, includes auto-collected from prompts). */
  readonly contexts: readonly Context<z.ZodType>[]

  /** Get a prompt by id. Throws if not found. */
  get(id: string): AnyPrompt
  /** Find a prompt by id. Returns `undefined` if not found. */
  find(id: string): AnyPrompt | undefined
  /** List all registered prompts. */
  list(): AnyPrompt[]
  /** Get all prompts matching a specific tag. */
  byTag(tag: string): AnyPrompt[]
  /** Get all prompts matching *all* specified tags (intersection). */
  byTags(tags: string[]): AnyPrompt[]
  /** Get all unique tags across all registered prompts. */
  tags(): string[]

  /** Tear down: remove middleware, close devtools, clear globals. */
  dispose(): void
}

// ─────────────────────────────────────────────────────────────────
// Module-level security flags
// ─────────────────────────────────────────────────────────────────

let _autoEscape = true
let _securityWarnings = false

/** Whether auto-escape is currently enabled. */
export function isAutoEscapeEnabled(): boolean {
  return _autoEscape
}

/** Whether security warnings are currently enabled. */
export function isSecurityWarningsEnabled(): boolean {
  return _securityWarnings
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Check if a value is a Prompt instance. */
function isPrompt(v: unknown): v is AnyPrompt {
  if (v == null || typeof v !== 'object' || !('_tag' in v)) return false
  return (v as { _tag: unknown })._tag === 'Prompt'
}

/** Check if a value is a Context instance. */
function isContext(v: unknown): v is Context<z.ZodType> {
  if (v == null || typeof v !== 'object' || !('_tag' in v)) return false
  return (v as { _tag: unknown })._tag === 'Context'
}

/** Read the `_all` flat accessor exposed by `createPrompts()` / `createContexts()`. */
function readAllAccessor<T>(input: object): T[] | undefined {
  if (!('_all' in input)) return undefined
  const value = (input as { _all: unknown })._all
  return Array.isArray(value) ? (value as T[]) : undefined
}

/** Extract flat Prompt[] from a tree or array. */
function extractPrompts(input: PromptInput): AnyPrompt[] {
  if (Array.isArray(input)) return input

  // Check for _all (from createPrompts)
  const all = readAllAccessor<AnyPrompt>(input)
  if (all) return all

  // Walk tree manually
  const result: AnyPrompt[] = []
  function walk(node: unknown) {
    if (isPrompt(node)) {
      result.push(node)
      return
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) walk(v)
    }
  }
  walk(input)
  return result
}

/** Extract flat Context[] from a tree or array. */
function extractContexts(input: ContextInput | undefined): Context<z.ZodType>[] {
  if (!input) return []
  if (Array.isArray(input)) return input

  // Check for _all (from createContexts)
  const all = readAllAccessor<Context<z.ZodType>>(input)
  if (all) return all

  // Walk tree manually
  const result: Context<z.ZodType>[] = []
  function walk(node: unknown) {
    if (isContext(node)) {
      result.push(node)
      return
    }
    if (node && typeof node === 'object') {
      for (const v of Object.values(node)) walk(v)
    }
  }
  walk(input)
  return result
}

/**
 * Compute namespace paths from a tree.
 * Returns a Map of instance id → path segments (e.g., 'draft-edit' → ['editor', 'edit']).
 */
function computePaths(
  input: unknown,
  getId: (v: unknown) => string | undefined,
  isLeaf: (v: unknown) => boolean,
): Map<string, string[]> {
  const paths = new Map<string, string[]>()

  if (Array.isArray(input)) return paths // flat arrays have no tree structure

  function walk(node: unknown, path: string[]) {
    if (isLeaf(node)) {
      const id = getId(node)
      if (id) paths.set(id, path)
      return
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === '_all') continue // skip _all property
        walk(value, [...path, key])
      }
    }
  }

  walk(input, [])
  return paths
}

/** Auto-collect contexts from prompts' `use` arrays, deduped with explicit ones. */
function collectContexts(prompts: AnyPrompt[], explicit: Context<z.ZodType>[]): Context<z.ZodType>[] {
  const seen = new Set<Context<z.ZodType>>(explicit)
  for (const p of prompts) {
    for (const c of p.contexts) {
      if (isContext(c)) seen.add(c)
    }
  }
  return [...seen]
}

/** Build tag index from prompts. */
function buildTagIndex(prompts: AnyPrompt[]): Map<string, AnyPrompt[]> {
  const index = new Map<string, AnyPrompt[]>()
  for (const p of prompts) {
    for (const tag of p.tags) {
      let list = index.get(tag)
      if (!list) {
        list = []
        index.set(tag, list)
      }
      list.push(p)
    }
  }
  return index
}

// ─────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────

/**
 * Configure the prompt system.
 *
 * Sets up devtools, middleware, and tokenizer in a single call.
 * Accepts prompt/context trees or flat arrays. Returns a frozen config object
 * with registry methods for looking up prompts by id or tag.
 *
 * @example
 * ```ts
 * import { configure, createPrompts, createContexts } from '@crux/core'
 *
 * const prompts = createPrompts({
 *   editor: { edit: draftEdit, seo: seoEdit },
 *   agent:  { planner: writerPlanner },
 * })
 *
 * const contexts = createContexts({
 *   brand: { voice: brand, profile: brandProfileContext },
 * })
 *
 * const config = configure({
 *   prompts,
 *   contexts,
 *   devtools: { serverUrl: process.env.DEVTOOLS_URL },
 * })
 *
 * config.get('draft-edit')   // Prompt by id
 * config.byTag('editing')    // Prompts by tag
 * config.dispose()           // Tear down
 * ```
 */
export function configure(options: ConfigureOptions): PromptRegistry {
  // Extract flat lists
  const prompts = extractPrompts(options.prompts)
  const explicitContexts = extractContexts(options.contexts)
  const contexts = collectContexts(prompts, explicitContexts)

  // Validate: all prompts must have an id, no duplicates
  const byId = new Map<string, AnyPrompt>()
  for (const p of prompts) {
    if (!p.id) {
      throw new Error('configure: all prompts must have an id')
    }
    if (byId.has(p.id)) {
      throw new Error(`configure: duplicate prompt id "${p.id}"`)
    }
    byId.set(p.id, p)
  }

  // Build tag index
  const tagIndex = buildTagIndex(prompts)

  // Apply globals
  _autoEscape = options.autoEscape !== false // default: true
  _securityWarnings =
    options.securityWarnings ?? (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production')
  if (options.tokenizer) setTokenizer(options.tokenizer)

  // Build initial runtime from explicit options
  const initialRuntime = {
    ...getRuntime(),
    ...(options.middleware ? { middleware: options.middleware } : {}),
  }

  // Apply the initial runtime so plugins can chain onto it
  setRuntime(initialRuntime)

  // Build plugins array — auto-prepend devtools if serverUrl is set
  const plugins: CruxPlugin[] = []
  const dt = options.devtools
  if (dt?.serverUrl) {
    const readId = (v: unknown): string | undefined => {
      if (v == null || typeof v !== 'object') return undefined
      const id = (v as { id?: unknown }).id
      return typeof id === 'string' ? id : undefined
    }
    const promptPaths = computePaths(options.prompts, readId, isPrompt)
    const contextPaths = computePaths(options.contexts, readId, isContext)
    const paths = new Map<string, string[]>([...promptPaths, ...contextPaths])

    plugins.push(
      withDevtools({
        prompts,
        contexts,
        serverUrl: dt.serverUrl,
        bridge: dt.bridge,
        paths: paths.size > 0 ? paths : undefined,
        tools: options.tools,
      }),
    )
  }
  if (options.plugins) {
    plugins.push(...options.plugins)
  }

  // Apply all plugins — each sees the cumulative runtime from prior plugins
  let pluginDispose: (() => void) | undefined
  if (plugins.length > 0) {
    const result = applyPlugins(plugins, getRuntime())
    setRuntime(result.runtime)
    pluginDispose = result.dispose
  }

  return Object.freeze({
    prompts: Object.freeze([...prompts]),
    contexts: Object.freeze([...contexts]),

    get(id: string) {
      const p = byId.get(id)
      if (!p) throw new Error(`configure: prompt "${id}" not found`)
      return p
    },

    find(id: string) {
      return byId.get(id)
    },

    list() {
      return [...prompts]
    },

    byTag(tag: string) {
      return tagIndex.get(tag) ?? []
    },

    byTags(tags: string[]) {
      const sets = tags.map((t) => new Set(tagIndex.get(t) ?? []))
      if (sets.length === 0) return []
      return [...sets[0]].filter((p) => sets.every((s) => s.has(p)))
    },

    tags() {
      return [...tagIndex.keys()]
    },

    dispose() {
      pluginDispose?.()
      resetRuntime()
    },
  })
}
