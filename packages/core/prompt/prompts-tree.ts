import type { AnyPrompt } from './prompt-types'

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

/** A nested object where leaves are `Prompt` instances and branches are groups. */
export type PromptTree = { [key: string]: AnyPrompt | PromptTree }

/** Recursively marks all properties as `readonly`, preserving `Prompt` leaf types. */
type DeepReadonlyPrompts<T> = {
  readonly [K in keyof T]: T[K] extends AnyPrompt ? T[K] : DeepReadonlyPrompts<T[K]>
}

/**
 * Union of every prompt leaf in a tree. Mirrors `LeafContextOf` from
 * `createContexts()` — lets `tree._all[number]` narrow to the actual prompt
 * types rather than the widened `AnyPrompt`.
 */
export type LeafPromptOf<T> = T extends AnyPrompt
  ? T
  : T extends Record<string, unknown>
    ? { [K in keyof T]: LeafPromptOf<T[K]> }[keyof T]
    : never

/** The return type of `createPrompts()` — a frozen tree with a hidden `_all` flat accessor. */
export type PromptTreeResult<T> = DeepReadonlyPrompts<T> & {
  readonly _all: LeafPromptOf<T>[]
}

// ─────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────

/**
 * Organize prompts into a nested, frozen tree with full type inference.
 *
 * Mirrors `createContexts()` — a typed const object where IDE autocomplete
 * shows everything available at each nesting level. Scales from a few prompts
 * to hundreds with clear namespace organization.
 *
 * The returned tree also exposes a non-enumerable `_all` property containing
 * a flat array of every `Prompt` in the tree, for passing to `configure()`.
 *
 * ```ts
 * const prompts = createPrompts({
 *   editor: { edit: draftEdit, seo: seoEdit },
 *   agent:  { planner: writerPlanner },
 *   chat:   { title: conversationTitle },
 * })
 *
 * prompts.editor.edit    // Prompt<...> with full type inference
 * prompts._all           // Prompt[] (flat, all leaves)
 * ```
 *
 * All leaf values must be `Prompt` instances (fails fast on typos).
 * The returned tree is deep-frozen and fully readonly.
 *
 * @param tree - Nested object of prompts and prompt groups.
 * @returns A deep-frozen tree with `_all` flat accessor.
 */
export function createPrompts<const T extends PromptTree>(tree: T): PromptTreeResult<T> {
  const all: AnyPrompt[] = []

  function validate(node: unknown, path: string): void {
    if (
      node &&
      typeof node === 'object' &&
      '_tag' in node &&
      (node as { _tag: unknown })._tag === 'Prompt'
    ) {
      all.push(node as AnyPrompt)
      return
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, value] of Object.entries(node)) {
        validate(value, path ? `${path}.${key}` : key)
      }
      return
    }
    throw new Error(`createPrompts: invalid value at "${path}" — expected Prompt or nested object`)
  }

  validate(tree, '')

  // Deep freeze the tree
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

  return deepFreeze(result) as PromptTreeResult<T>
}
