import type { Tool } from 'ai'
import type {
  ModelIngressGuard,
  ToolModelIngressDialect,
  ToolModelInputOrigin,
} from '@use-crux/core/adapter'
import {
  aiSdkToolContentDocument,
  applyAiSdkToolContentPatch,
} from './tool-model-ingress-content'

type NativeTool = Tool<unknown, unknown>

/** @internal Native AI SDK result accepted by `Tool.toModelOutput()`. */
export type AiSdkToolResultOutput = Awaited<
  ReturnType<NonNullable<NativeTool['toModelOutput']>>
>

interface NativeToolOutputArgs {
  readonly toolCallId: string
  readonly input: unknown
  readonly output: unknown
}

interface NativeToolShape {
  readonly execute?: unknown
  readonly toModelOutput?: (
    args: NativeToolOutputArgs,
  ) => AiSdkToolResultOutput | PromiseLike<AiSdkToolResultOutput>
}

/** @internal Wrap client tools at the AI SDK's native model-output seam. */
export const withAiSdkToolModelIngress: ToolModelIngressDialect = (
  tools,
  guard,
  options,
) => {
  const wrapped: Record<string, unknown> = {}
  for (const [toolName, tool] of Object.entries(tools)) {
    if (!tool || typeof tool !== 'object' || typeof (tool as NativeToolShape).execute !== 'function') {
      wrapped[toolName] = tool
      continue
    }
    const shape = tool as NativeToolShape
    const convert = shape.toModelOutput
    const guardedByCall = new Map<string, Promise<AiSdkToolResultOutput>>()
    wrapped[toolName] = {
      ...tool,
      async toModelOutput(this: unknown, args: NativeToolOutputArgs): Promise<AiSdkToolResultOutput> {
        const existing = guardedByCall.get(args.toolCallId)
        if (existing) return existing
        const pending = (async () => {
          const output = convert
            ? await convert.call(this, args)
            : defaultAiSdkToolModelOutput(args.output)
          return guardAiSdkToolModelOutput(
            output,
            {
              source: 'tool',
              kind: 'tool-result',
              toolName,
              toolCallId: args.toolCallId,
            },
            guard,
            options.provider,
          )
        })()
        guardedByCall.set(args.toolCallId, pending)
        return pending
      },
    }
  }
  return wrapped
}

async function guardAiSdkToolModelOutput(
  output: AiSdkToolResultOutput,
  origin: ToolModelInputOrigin,
  guard: ModelIngressGuard,
  provider: string | undefined,
): Promise<AiSdkToolResultOutput> {
  switch (output.type) {
    case 'text':
    case 'error-text': {
      const result = await guard({ kind: 'text', value: output.value, origin })
      if (result.kind !== 'text') throw new Error('Text model ingress returned a non-text patch.')
      return result.value === output.value ? output : { ...output, value: result.value }
    }
    case 'json':
    case 'error-json': {
      const rendered = JSON.stringify(output.value)
      const result = await guard({ kind: 'text', value: rendered, origin })
      if (result.kind !== 'text') throw new Error('JSON model ingress returned a non-text patch.')
      if (result.value === rendered) return output
      return {
        type: output.type === 'json' ? 'text' : 'error-text',
        value: result.value,
        ...(output.providerOptions ? { providerOptions: output.providerOptions } : {}),
      }
    }
    case 'content': {
      const result = await guard(aiSdkToolContentDocument(output, origin, provider))
      if (result.kind !== 'patch') throw new Error('Structured model ingress returned a text value.')
      return applyAiSdkToolContentPatch(output, result)
    }
    case 'execution-denied':
      return output
    default:
      return assertNever(output)
  }
}

function defaultAiSdkToolModelOutput(output: unknown): AiSdkToolResultOutput {
  return typeof output === 'string'
    ? { type: 'text', value: output }
    : { type: 'json', value: output === undefined ? null : output } as AiSdkToolResultOutput
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported AI SDK tool model output: ${String(value)}`)
}
