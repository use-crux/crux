/**
 * Pure registry-building helpers for `configure()`.
 *
 * These functions turn prompt/context trees (from `createPrompts()` /
 * `createContexts()`) or flat arrays into the flat lists, namespace paths, and
 * tag index that the registry exposes. They are deliberately side-effect-free —
 * the stateful security flags and global runtime wiring stay in `configure.ts`.
 *
 * @module
 */

import type { z } from 'zod'
import type { AnyPrompt, Context } from '../types'

/**
 * Accepts a PromptTree, the frozen result of createPrompts(), or a flat array.
 * Uses `Record<string, unknown>` for tree inputs because PromptTreeResult
 * includes a non-enumerable `_all` that breaks strict index signatures.
 */
export type PromptInput = AnyPrompt[] | Record<string, unknown>
/** Accepts a ContextTree, the frozen result of createContexts(), or a flat array. */
export type ContextInput = Context<z.ZodType>[] | Record<string, unknown>

/** Check if a value is a Prompt instance. */
export function isPrompt(v: unknown): v is AnyPrompt {
  if (v == null || typeof v !== 'object' || !('_tag' in v)) return false
  return (v as { _tag: unknown })._tag === 'Prompt'
}

/** Check if a value is a Context instance. */
export function isContext(v: unknown): v is Context<z.ZodType> {
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
export function extractPrompts(input: PromptInput): AnyPrompt[] {
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
export function extractContexts(input: ContextInput | undefined): Context<z.ZodType>[] {
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
export function computePaths(
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
export function collectContexts(prompts: AnyPrompt[], explicit: Context<z.ZodType>[]): Context<z.ZodType>[] {
  const seen = new Set<Context<z.ZodType>>(explicit)
  for (const p of prompts) {
    for (const c of p.contexts) {
      if (isContext(c)) seen.add(c)
    }
  }
  return [...seen]
}

/** Build tag index from prompts. */
export function buildTagIndex(prompts: AnyPrompt[]): Map<string, AnyPrompt[]> {
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
