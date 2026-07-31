/**
 * Definition-time input-schema collection for prompt compilation.
 *
 * Runtime entry resolution lives in `lower.ts` + `driver.ts`; this module
 * mirrors that traversal only for the "what input shape can this prompt
 * accept?" question. Keeping it separate from runtime lowering avoids turning
 * the entry union dispatcher into the owner of both runtime and compiler
 * concerns.
 *
 * @module
 */

import type { z } from 'zod'
import type { ConditionalContext, Context, ContextEntry, MatchSpec } from '../prompt/context-types'
import { isContributorEntry } from '../prompt/contributor'
import { isInternalInjectableEntry } from '../prompt/internal-injection'
import { isToolSource } from '../tools/tool-source'
import {
  compileRepresentationLadder,
  isForcedOffload,
  isRepresentationLadder,
} from '../request/representation/ladder'
import type { SchemaContribution } from './contract'

const SCHEMA_CONTRIBUTION_SOURCE: unique symbol = Symbol('crux.schemaContributionSource')

type InternalSchemaContribution = SchemaContribution & {
  readonly [SCHEMA_CONTRIBUTION_SOURCE]?: object
}

function schemaContribution(
  contribution: SchemaContribution,
  source: object | undefined,
): SchemaContribution {
  if (!source) return contribution
  Object.defineProperty(contribution, SCHEMA_CONTRIBUTION_SOURCE, {
    value: source,
    enumerable: false,
  })
  return contribution
}

/**
 * Return the object identity that produced a schema contribution, when known.
 *
 * Prompt compilation uses this to dedupe the same context instance reached
 * through multiple conditional branches while still reporting conflicts
 * between distinct entries that happen to have the same anonymous label.
 */
export function schemaContributionSource(contribution: SchemaContribution): object | undefined {
  return (contribution as InternalSchemaContribution)[SCHEMA_CONTRIBUTION_SOURCE]
}

/**
 * Collect every input-schema contribution reachable from `entries`.
 *
 * The traversal mirrors the runtime driver: nested `use` entries under
 * contexts, contributors, `when()` wrappers, and `match()` branches are all
 * visited. Entries that cannot contribute schema still occupy a slot so
 * anonymous conflict labels stay aligned with author-written `use` positions.
 *
 * Optional-path rules:
 * - plain context: optional when any parent path is optional or it has `when`
 * - `when()` wrapper and `match()` branches: always optional
 * - contributor: optional when any parent path is optional or it has `when`
 * - injectable: optional when a parent path is optional
 */
export function collectSchemaContributions(
  entries: readonly ContextEntry[],
  optionalPath = false,
): SchemaContribution[] {
  const out: SchemaContribution[] = []

  for (const entry of entries) {
    if (!entry) {
      out.push({ id: undefined, schema: undefined, optional: optionalPath })
      continue
    }

    if (isContributorEntry(entry)) {
      const entryOptional = optionalPath || !!entry.when
      if (entry.inputSchema) {
        out.push(schemaContribution({ id: entry.id, schema: entry.inputSchema, optional: entryOptional }, entry))
      }
      out.push(...collectSchemaContributions(entry.useEntries, entryOptional))
      continue
    }

    if (isInternalInjectableEntry(entry)) {
      if (entry.inputSchema) {
        out.push(schemaContribution({ id: entry.id, schema: entry.inputSchema, optional: optionalPath }, entry))
      }
      continue
    }

    if (isForcedOffload(entry)) {
      out.push({ id: undefined, schema: undefined, optional: optionalPath })
      continue
    }

    if (isRepresentationLadder(entry)) {
      out.push(
        ...collectSchemaContributions(
          compileRepresentationLadder(entry).primarySources,
          optionalPath,
        ),
      )
      continue
    }

    if (isToolSource(entry)) {
      out.push({ id: undefined, schema: undefined, optional: optionalPath })
      continue
    }

    if (
      entry._tag === 'Skill' ||
      entry._tag === 'Memory' ||
      entry._tag === 'Blackboard' ||
      entry._tag === 'HistoryRecent'
    ) {
      out.push({ id: undefined, schema: undefined, optional: optionalPath })
      continue
    }

    if (entry._tag === 'MatchSpec') {
      const spec = entry as MatchSpec
      for (const branch of Object.values(spec.cases)) {
        const branchContexts = Array.isArray(branch) ? branch : [branch as Context<z.ZodType>]
        out.push(...collectSchemaContributions(branchContexts, true))
      }
      if (spec.default) {
        const defaults = Array.isArray(spec.default) ? spec.default : [spec.default as Context<z.ZodType>]
        out.push(...collectSchemaContributions(defaults, true))
      }
      continue
    }

    if (entry._tag === 'ConditionalContext') {
      const cond = entry as ConditionalContext<Context<z.ZodType>>
      out.push(...collectSchemaContributions([cond.context], true))
      continue
    }

    const ctx = entry as Context<z.ZodType>
    if (ctx.useEntries.length > 0) {
      out.push(...collectSchemaContributions(ctx.useEntries, optionalPath || !!ctx.when))
    }
    out.push(schemaContribution({ id: ctx.id, schema: ctx.inputSchema, optional: optionalPath || !!ctx.when }, ctx))
  }

  return out
}
