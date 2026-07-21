import type { ModelIngressGuard, ToolModelInputOrigin } from '../../safety/input/model-ingress'
import type { ToolModelOutput } from '../../types/tool'
import { renderToolModelOutput } from './emission'

/** Inputs required to guard one post-conversion tool result. */
export interface GuardToolModelOutputOptions {
  readonly output: ToolModelOutput
  readonly toolName: string
  readonly toolCallId?: string
  readonly guard?: ModelIngressGuard
}

/** Guard a canonical tool result after conversion and before model writeback. */
export async function guardToolModelOutput(options: GuardToolModelOutputOptions): Promise<ToolModelOutput> {
  if (!options.guard) return options.output

  switch (options.output.type) {
    case 'text':
    case 'error-text': {
      const guarded = await options.guard({
        kind: 'text',
        value: options.output.value,
        origin: toolOrigin(options),
      })
      if (guarded.kind !== 'text') throw new Error('Text model ingress returned non-text content.')
      return guarded.value === options.output.value ? options.output : { ...options.output, value: guarded.value }
    }
    case 'content': {
      const guarded = await options.guard({
        kind: 'content',
        value: options.output.value,
        origin: toolOrigin(options),
      })
      if (guarded.kind !== 'content') throw new Error('Content model ingress returned non-content text.')
      return guarded.value === options.output.value ? options.output : { ...options.output, value: guarded.value }
    }
    case 'json':
    case 'error-json': {
      const rendered = renderToolModelOutput(options.output)
      const guarded = await options.guard({
        kind: 'text',
        value: rendered,
        origin: toolOrigin(options),
      })
      if (guarded.kind !== 'text') throw new Error('JSON model ingress returned non-text content.')
      if (guarded.value === rendered) return options.output
      return {
        type: options.output.type === 'json' ? 'text' : 'error-text',
        value: guarded.value,
        ...(options.output.providerOptions ? { providerOptions: options.output.providerOptions } : {}),
      }
    }
    case 'execution-denied':
      return options.output
  }
}

function toolOrigin(options: GuardToolModelOutputOptions): ToolModelInputOrigin {
  return {
    source: 'tool',
    kind: 'tool-result',
    toolName: options.toolName,
    ...(options.toolCallId !== undefined ? { toolCallId: options.toolCallId } : {}),
  }
}
