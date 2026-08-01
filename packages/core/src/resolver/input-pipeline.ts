/**
 * Helpers for preparing prompt input before resolution walks `use` entries.
 *
 * The compiler pass owns the pipeline order; this module keeps the supporting
 * scans small and reusable: declared `rawFields` for top-level auto-escape
 * exemptions, and nested-string detection for the warning that auto-escape
 * does not rewrite object/array internals.
 *
 * @module
 */

import type { z } from 'zod'
import type {
  BlackboardEntry,
  ConditionalContext,
  Context,
  ContextEntry,
  ContributorEntry,
  MatchSpec,
  MemoryEntry,
} from '../prompt/context-types'
import {
  compileRepresentationLadder,
  isForcedOffload,
  isRepresentationLadder,
} from '../request/representation/ladder'
import { PREPARATION_RESOURCES_INPUT } from '../request/prepare/pin-context'

const RESOLVER_PRIVATE_INPUT_KEYS = [
  '_crux_activeSkills',
  PREPARATION_RESOURCES_INPUT,
] as const

/**
 * Extract resolver-owned metadata fields before user input validation.
 *
 * These fields are not part of a prompt's public input schema, so Zod object
 * parsing, user sanitizers, and auto-escape should not be able to strip or
 * rewrite them. The pass merges this metadata back only after the user input
 * pipeline has finished.
 */
export function collectResolverPrivateInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') return {}

  const source = input as Record<string, unknown>
  const privateInput: Record<string, unknown> = {}
  for (const key of RESOLVER_PRIVATE_INPUT_KEYS) {
    if (key in source) privateInput[key] = source[key]
  }
  return privateInput
}

/** Merge resolver-owned metadata back into parsed user input when present. */
export function mergeResolverPrivateInput(
  input: Record<string, unknown>,
  privateInput: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(privateInput).length === 0) return input
  return { ...input, ...privateInput }
}

/** Collect top-level input fields declared as trusted by statically reachable contexts. */
export function collectDeclaredRawFields(entries: readonly ContextEntry[]): string[] {
  const rawFields = new Set<string>()
  for (const entry of entries) collectEntryRawFields(entry, rawFields)
  return [...rawFields]
}

function collectEntryRawFields(entry: ContextEntry, rawFields: Set<string>): void {
  if (!entry) return

  if (isForcedOffload(entry)) return

  if (isRepresentationLadder(entry)) {
    for (const source of compileRepresentationLadder(entry).primarySources) {
      collectEntryRawFields(source, rawFields)
    }
    return
  }

  if (isContextEntry(entry)) {
    collectContextRawFields(entry, rawFields)
    return
  }
  if (isConditionalContextEntry(entry)) {
    collectContextRawFields(entry.context, rawFields)
    return
  }
  if (isMatchEntry(entry)) {
    for (const branch of Object.values(entry.cases)) collectContextBranchRawFields(branch, rawFields)
    if (entry.default) collectContextBranchRawFields(entry.default, rawFields)
    return
  }
  if (isMemoryOrBlackboardEntry(entry)) {
    collectContextRawFields(entry.asContext(), rawFields)
    return
  }
  if (isContributorRawFieldEntry(entry)) {
    for (const child of entry.useEntries) collectEntryRawFields(child, rawFields)
  }
}

function isContextEntry(entry: ContextEntry): entry is Context<z.ZodType> {
  return !!entry && entry._tag === 'Context' && 'rawFields' in entry && 'useEntries' in entry
}

function isConditionalContextEntry(
  entry: ContextEntry,
): entry is ConditionalContext<Context<z.ZodType>> {
  return !!entry && entry._tag === 'ConditionalContext' && 'context' in entry
}

function isMatchEntry(entry: ContextEntry): entry is MatchSpec {
  return !!entry && entry._tag === 'MatchSpec' && 'cases' in entry
}

function isMemoryOrBlackboardEntry(
  entry: ContextEntry,
): entry is MemoryEntry | BlackboardEntry {
  return !!entry && (entry._tag === 'Memory' || entry._tag === 'Blackboard') && 'asContext' in entry
}

function isContributorRawFieldEntry(
  entry: ContextEntry,
): entry is ContributorEntry<z.ZodType> {
  return !!entry && entry._tag === 'Contributor' && 'useEntries' in entry
}

function collectContextBranchRawFields(
  branch: Context<z.ZodType> | readonly Context<z.ZodType>[],
  rawFields: Set<string>,
): void {
  const contexts = Array.isArray(branch) ? branch : [branch]
  for (const ctx of contexts) collectContextRawFields(ctx, rawFields)
}

function collectContextRawFields(ctx: Context<z.ZodType>, rawFields: Set<string>): void {
  for (const field of ctx.rawFields) rawFields.add(field)
  for (const child of ctx.useEntries) collectEntryRawFields(child, rawFields)
}

/** Return true when an object or array contains any nested string value. */
export function containsNestedString(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  if (seen.has(value)) return false

  seen.add(value)

  if (Array.isArray(value)) {
    return value.some((item) => containsNestedString(item, seen))
  }

  return Object.values(value as Record<string, unknown>).some((child) => containsNestedString(child, seen))
}
