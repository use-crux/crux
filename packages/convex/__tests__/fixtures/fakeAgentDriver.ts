import type {
  ConvexAgentContextRequest,
  ConvexAgentContextSnapshot,
  ConvexAgentDriver,
  ConvexAgentDriverDefinition,
  ConvexAgentSession,
  ConvexAgentToolDefinition,
} from '../../agent/driver'

export class FakeConvexAgentDriver implements ConvexAgentDriver {
  readonly definitions: ConvexAgentDriverDefinition[] = []
  readonly generatedTextCalls: Array<{
    ctx: unknown
    target: Record<string, unknown>
    args: Record<string, unknown>
    options: Record<string, unknown> | undefined
  }> = []
  readonly streamedTextCalls: Array<{
    ctx: unknown
    target: Record<string, unknown>
    args: Record<string, unknown>
    options: Record<string, unknown> | undefined
  }> = []
  readonly contextRequests: ConvexAgentContextRequest[] = []
  readonly createdTools: ConvexAgentToolDefinition[] = []
  readonly wrappedTools: Array<{ tool: unknown; name?: string }> = []
  contextSnapshot?: ConvexAgentContextSnapshot
  textResult: unknown = { text: 'generated text' }
  streamResult: unknown = { textStream: 'streamed text' }
  onGenerateText?: (call: {
    readonly definition: ConvexAgentDriverDefinition
    readonly ctx: unknown
    readonly target: Record<string, unknown>
    readonly args: Record<string, unknown>
    readonly options: Record<string, unknown> | undefined
  }) => Promise<void> | void
  onStreamText?: (call: {
    readonly definition: ConvexAgentDriverDefinition
    readonly ctx: unknown
    readonly target: Record<string, unknown>
    readonly args: Record<string, unknown>
    readonly options: Record<string, unknown> | undefined
  }) => Promise<void> | void

  create(definition: ConvexAgentDriverDefinition): ConvexAgentSession {
    this.definitions.push(definition)
    return {
      generateText: async (ctx, target, args, options) => {
        this.generatedTextCalls.push({ ctx, target, args, options })
        await this.onGenerateText?.({ definition, ctx, target, args, options })
        return this.textResult
      },
      streamText: async (ctx, target, args, options) => {
        this.streamedTextCalls.push({ ctx, target, args, options })
        await this.onStreamText?.({ definition, ctx, target, args, options })
        return this.streamResult
      },
      continueThread: async (_ctx, target) => ({
        thread: {
          threadId: target.threadId,
          getMetadata: async () => ({}),
          updateMetadata: async (patch) => patch,
        },
      }),
    }
  }

  async fetchContext(request: ConvexAgentContextRequest): Promise<ConvexAgentContextSnapshot> {
    this.contextRequests.push(request)
    if (!this.contextSnapshot) {
      throw new Error('FakeConvexAgentDriver.contextSnapshot must be set before fetchContext().')
    }
    return this.contextSnapshot
  }

  createTool(definition: ConvexAgentToolDefinition): unknown {
    this.createdTools.push(definition)
    return {
      description: definition.description,
      inputSchema: definition.inputSchema,
      execute: definition.execute,
    }
  }

  wrapTool<TTool>(tool: TTool, options: { name?: string } = {}): TTool {
    this.wrappedTools.push({ tool, name: options.name })
    return tool
  }
}
