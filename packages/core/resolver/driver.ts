/**
 * The resolution driver — one loop for every entry family.
 *
 * `resolveUse()` walks a `use:` array of lowered contributors and merges
 * their answers into a single {@link MergedResolution}. It owns recursion,
 * ordering, exclusion bookkeeping, channel merging with collision policy,
 * and every observability emission for entry resolution — contributors hand
 * it facts, never spans or artifacts.
 *
 * Ordering guarantees (pinned by characterization tests):
 *
 * 1. Entries resolve strictly in `use:` order; falsy entries are skipped.
 * 2. Gate facts (predicate spans, exclusion artifacts) emit before anything
 *    else the entry does.
 * 3. An entry's children (nested `use:` entries, match branches) merge
 *    BEFORE the entry's own contribution — a wrapper context's system text
 *    appears after the entries it bundles.
 * 4. Re-entered entries (`Contribution.use`, injectable contexts) restart
 *    positional indexing at 0, so their exclusion labels are branch-local.
 * 5. Contribution facts (tool-injection artifacts) emit after the entry's
 *    channels merge.
 *
 * Tool-name collisions throw immediately with the owning entry attributed —
 * silent overwrite would bind the model to the wrong tool implementation.
 *
 * @module
 */

import type { CruxArtifactId } from '../observability/contract'
import type { CruxContextContributionPreview } from '../observability/contract'
import type { ContextEntry } from '../prompt/context-types'
import type { ToolMiddleware } from '../tools/types'
import {
  emptyMergedResolution,
  type ContributionFacts,
  type GateResult,
  type LoweredContributor,
  type MergedResolution,
} from './contract'
import { lowerContext, lowerEntry } from './lower'
import type { ResolverPorts } from './ports'
import { mergeOwnedToolSet, mergeToolSet } from './tool-merge'

const INCLUDED: GateResult = Object.freeze({ include: true })

/**
 * Emit a `context.contribution` artifact through the observability port,
 * mirroring the artifact attributes and produced-edge metadata the pipeline
 * has always emitted. The single emission site for all entry families.
 */
export function emitContributionArtifact(
  ports: ResolverPorts,
  preview: CruxContextContributionPreview,
): CruxArtifactId | undefined {
  const attributes: Record<string, unknown> = {
    source: preview.sourceId,
    state: preview.state,
    included: preview.included,
    injectableKind: preview.injectableKind,
  }
  if (preview.reason) attributes.reason = preview.reason
  if (preview.branch) attributes.branch = preview.branch
  if (preview.tokens !== undefined) attributes.tokens = preview.tokens
  if (preview.cacheStatus) attributes.cacheStatus = preview.cacheStatus
  if (preview.injectedTools) attributes.injectedTools = preview.injectedTools
  return ports.observability.artifact(
    {
      kind: 'context.contribution',
      contentType: 'application/json',
      encoding: 'json',
      sizeBytes: preview.sizeBytes,
      preview,
      attributes,
    },
    { source: preview.sourceId, state: preview.state },
  )
}

/** Emit the tool-injection artifact for a contribution, skipping silent (no-channel) contributions. */
function emitFacts(ports: ResolverPorts, facts: ContributionFacts): void {
  if (!facts.injectedTools && !facts.injects) return
  emitContributionArtifact(ports, {
    kind: 'context.contribution',
    state: 'active',
    included: true,
    sourceId: facts.sourceId,
    injectableKind: facts.injectableKind,
    injects: facts.injects,
    injectedTools: facts.injectedTools,
  })
}

/** Fold a child resolution into the accumulator while preserving per-tool owners. */
function mergeNested(out: MergedResolution, nested: MergedResolution): void {
  out.active.push(...nested.active)
  out.excluded.push(...nested.excluded)
  out.skills.push(...nested.skills)
  out.memories.push(...nested.memories)
  out.blackboards.push(...nested.blackboards)
  mergeOwnedToolSet(out.tools, out.toolOwners, nested.tools, nested.toolOwners)
  out.toolMiddleware.push(...nested.toolMiddleware)
  out.constraints.push(...nested.constraints)
  out.guardrails.push(...nested.guardrails)
  out.metadata = { ...out.metadata, ...nested.metadata }
}

/**
 * Maximum nesting depth for entry resolution. Legitimate composition
 * (contexts bundling contexts, injectables contributing entries) is a few
 * levels deep; hitting this limit means a contributor or injectable is
 * re-entering itself through `use`/`contexts` and resolution would never
 * terminate.
 */
const MAX_RESOLVE_DEPTH = 32

/**
 * Resolve a `use:` array into the merged channels the rest of the pipeline
 * consumes. See the module doc for ordering guarantees.
 *
 * @param entries - The raw entries (the driver lowers them itself).
 * @param input - The resolved prompt input, passed to gates and contributors.
 * @param promptId - The owning prompt's id, for contributor attribution.
 * @param ports - The pipeline's capability ports (observability is the only one used here).
 * @param depth - Current nesting level; recursion beyond {@link MAX_RESOLVE_DEPTH} throws.
 */
export async function resolveUse(
  entries: readonly ContextEntry[],
  input: Record<string, unknown>,
  promptId: string | undefined,
  ports: ResolverPorts,
  depth = 0,
  seenContextIds = new Set<string>(),
  dynamicSourceId?: string,
  staticEntryIds: ReadonlySet<string> = new Set(),
): Promise<MergedResolution> {
  const out = emptyMergedResolution()
  for (let index = 0; index < entries.length; index++) {
    const contributor = lowerEntry(entries[index], index)
    if (!contributor) continue
    await runContributor(
      contributor,
      out,
      input,
      promptId,
      ports,
      depth,
      seenContextIds,
      dynamicSourceId,
      staticEntryIds,
    )
  }
  return out
}

async function runContributor(
  contributor: LoweredContributor,
  out: MergedResolution,
  input: Record<string, unknown>,
  promptId: string | undefined,
  ports: ResolverPorts,
  depth: number,
  seenContextIds: Set<string>,
  dynamicSourceId: string | undefined,
  staticEntryIds: ReadonlySet<string>,
): Promise<void> {
  if (depth >= MAX_RESOLVE_DEPTH) {
    throw new Error(
      `Context entry resolution exceeded ${MAX_RESOLVE_DEPTH} levels of nesting at "${contributor.mergeSourceId}". ` +
        `A contributor or injectable is likely re-entering itself via its use/contexts contribution.`,
    )
  }

  if (contributor.family === 'context' && contributor.id) {
    if (dynamicSourceId && (seenContextIds.has(contributor.id) || staticEntryIds.has(contributor.id))) {
      throw new Error(
        `resolve(${promptId ?? 'unknown'}): contributor "${dynamicSourceId}" injected context id ` +
          `"${contributor.id}" which already exists in this prompt.`,
      )
    }
    seenContextIds.add(contributor.id)
  }

  const gate = contributor.gate ? contributor.gate(input) : INCLUDED

  if (gate.steps) {
    for (const step of gate.steps) {
      await ports.observability.scope(
        { name: step.span.name, family: 'context', primitive: 'context.predicate', attributes: step.span.attributes },
        async () => {
          if (step.artifact) emitContributionArtifact(ports, step.artifact)
        },
      )
    }
  }

  if (!gate.include) {
    out.excluded.push({ source: gate.source, reason: gate.reason })
    return
  }

  const children = gate.children ?? contributor.children?.(input)
  if (children && children.length > 0) {
    mergeNested(
      out,
      await resolveUse(children, input, promptId, ports, depth + 1, seenContextIds, dynamicSourceId, staticEntryIds),
    )
  }

  const contribution = contributor.contribute ? await contributor.contribute({ input, promptId }) : {}

  // Collections register before context expansion so binding order matches
  // entry order even when an expansion nests further collectable entries.
  if (contribution.memory) out.memories.push(contribution.memory)
  if (contribution.skill) out.skills.push(contribution.skill)
  if (contribution.blackboard) out.blackboards.push(contribution.blackboard)

  if (contribution.use && contribution.use.length > 0) {
    mergeNested(
      out,
      await resolveUse(
        contribution.use,
        input,
        promptId,
        ports,
        depth + 1,
        seenContextIds,
        contributor.mergeSourceId,
        staticEntryIds,
      ),
    )
  }

  if (contribution.appendContexts) {
    // Memory/blackboard context expansions run through the identical
    // plain-context path (own `when`, nested entries) at this entry's index.
    for (const ctx of contribution.appendContexts) {
      await runContributor(
        lowerContext(ctx, contributor.index),
        out,
        input,
        promptId,
        ports,
        depth + 1,
        seenContextIds,
        contributor.mergeSourceId,
        staticEntryIds,
      )
    }
  }

  if (contribution.contexts) out.active.push(...contribution.contexts)
  if (contribution.tools && contributor.toolOwnerLabel) {
    mergeToolSet(out.tools, out.toolOwners, contribution.tools, contributor.toolOwnerLabel)
  }
  if (contribution.toolMiddleware) out.toolMiddleware.push(...normalizeToolMiddleware(contribution.toolMiddleware))
  if (contribution.constraints) out.constraints.push(...contribution.constraints)
  if (contribution.guardrails) out.guardrails.push(...contribution.guardrails)
  if (contribution.metadata) out.metadata = { ...out.metadata, ...contribution.metadata }

  if (contribution.facts) emitFacts(ports, contribution.facts)
}

function normalizeToolMiddleware(middleware: ToolMiddleware | readonly ToolMiddleware[]): ToolMiddleware[] {
  return isToolMiddlewareArray(middleware) ? [...middleware] : [middleware]
}

function isToolMiddlewareArray(
  middleware: ToolMiddleware | readonly ToolMiddleware[],
): middleware is readonly ToolMiddleware[] {
  return Array.isArray(middleware)
}
