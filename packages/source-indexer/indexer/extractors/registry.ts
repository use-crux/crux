import { agentExtractor } from './agent'
import { compositionExtractor } from './composition'
import { contextExtractor } from './context'
import { evalExtractor } from './eval'
import { flowExtractor } from './flow'
import type { CatalogExtractor, StaticCallContext } from './types'
import { blackboardExtractor, memoryExtractor } from './memory'
import { promptExtractor } from './prompt'
import { ragExtractor } from './rag'
import { safetyExtractor } from './safety'
import { scorerExtractor } from './scorer'
import { toolExtractor } from './tool'
import { workspaceExtractor } from './workspace'

export const primitiveExtractors: readonly CatalogExtractor[] = [
  workspaceExtractor,
  memoryExtractor,
  blackboardExtractor,
  promptExtractor,
  contextExtractor,
  toolExtractor,
  agentExtractor,
  flowExtractor,
  ragExtractor,
  safetyExtractor,
  scorerExtractor,
  evalExtractor,
  compositionExtractor,
]

export function extractWithRegistry(ctx: StaticCallContext) {
  for (const extractor of primitiveExtractors) {
    if (!extractor.callNames.includes(ctx.callName)) continue
    const found = extractor.extract(ctx)
    if (found?.kind === 'found') return found
  }
  return undefined
}
