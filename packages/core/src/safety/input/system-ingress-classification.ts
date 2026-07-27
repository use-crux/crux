/** Trust classification for exact resolver-owned system ingress blocks. */

import type { SystemIngressBlock } from '../../resolver/system-ingress-provenance'
import { SafetyResultError } from '../errors'
import type {
  ModelInputOrigin,
  ModelInputOriginFor,
  TextInputSource,
} from '../input-origin'

/** One resolver block classified by destination and privacy-safe provenance. */
export type SystemIngressClassification =
  | {
      readonly boundary: 'model.input.text'
      readonly origin: ModelInputOriginFor<TextInputSource>
    }
  | {
      readonly boundary: 'model.instructions'
      readonly origin: Extract<
        ModelInputOrigin,
        { readonly source: 'instructions' }
      >
    }

/** Classify one lossless resolver contribution before policy selection. */
export function classifySystemIngressBlock(
  block: SystemIngressBlock,
  blockIndex: number,
): SystemIngressClassification {
  if (block.family === 'retriever') {
    return {
      boundary: 'model.input.text',
      origin: {
        source: 'retrieval',
        kind: 'retrieval-context',
        retrieverId: firstPartyId(block, 'retriever'),
        blockIndex,
      },
    }
  }
  if (block.family === 'memory') {
    return {
      boundary: 'model.input.text',
      origin: {
        source: 'memory',
        kind: 'memory-context',
        memoryId: firstPartyId(block, 'memory'),
        blockIndex,
      },
    }
  }
  if (block.family === 'blackboard') {
    return {
      boundary: 'model.input.text',
      origin: {
        source: 'memory',
        kind: 'blackboard-context',
        boardId: firstPartyId(block, 'blackboard'),
        blockIndex,
      },
    }
  }
  if (block.family === 'handoff') {
    return {
      boundary: 'model.input.text',
      origin: {
        source: 'handoff',
        kind: 'handoff-context',
        handoffId: firstPartyId(block, 'handoff'),
        blockIndex,
      },
    }
  }
  return {
    boundary: 'model.instructions',
    origin: {
      source: 'instructions',
      kind:
        block.family === 'prompt'
          ? 'prompt'
          : block.family === 'skill'
            ? 'skill'
            : 'context',
      ...(block.contextId ? { contextId: block.contextId } : {}),
      blockIndex,
    },
  }
}

function firstPartyId(
  block: SystemIngressBlock,
  family: 'blackboard' | 'handoff' | 'memory' | 'retriever',
): string {
  const prefix = `${family}:`
  if (block.contextId?.startsWith(prefix)) {
    return block.contextId.slice(prefix.length)
  }

  // Retrievers predate explicit context IDs and have a stable resolver source.
  if (family === 'retriever') {
    const source = block.source.startsWith(prefix)
      ? block.source.slice(prefix.length)
      : block.source
    if (source.length > 0) return source
  }

  throw new SafetyResultError({
    policyId: 'model-ingress',
    boundary: 'model.input.text',
    problem: `first-party ${family} ingress is missing its canonical id`,
    message: `Resolver-owned ${family} content could not be classified without ambiguous provenance.`,
  })
}
