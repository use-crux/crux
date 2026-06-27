import { createTool as convexCreateTool, fetchContextWithPrompt } from '@convex-dev/agent'
import type { ContextHandler } from '@convex-dev/agent'
import { Agent, type ConvexAgentComponent } from './facade'
import type {
  ConvexAgentContextRequest,
  ConvexAgentContextMessage,
  ConvexAgentContextSnapshot,
  ConvexAgentDriver,
  ConvexAgentDriverDefinition,
  ConvexAgentThreadSession,
  ConvexAgentToolOptions,
} from './driver'
import { stringValue } from './lifecycle-utils'
import { wrapConvexTool } from './sdk-tools'

type ConvexContextHandlerArgs = Parameters<ContextHandler>[1]
type ConvexContextHandlerCtx = Parameters<ContextHandler>[0]

/** Create the production driver backed by `@convex-dev/agent`. */
export function createDefaultConvexAgentDriver(): ConvexAgentDriver {
  return {
    create(definition) {
      return createDefaultConvexAgentSession(definition)
    },
    fetchContext: fetchThreadContextSnapshot,
    createTool(definition) {
      return convexCreateTool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (toolCtx, args, options?: ConvexAgentToolOptions) =>
          await definition.execute(toolCtx, args as Record<string, unknown>, options),
      })
    },
    wrapTool(tool, options) {
      return wrapConvexTool(tool, options)
    },
  }
}

function createDefaultConvexAgentSession(
  definition: ConvexAgentDriverDefinition,
): ReturnType<ConvexAgentDriver['create']> {
  const agent = new Agent(
    definition.component as ConvexAgentComponent,
    {
      ...definition.options,
      name: definition.name,
      languageModel: definition.languageModel,
      instructions: definition.instructions,
      tools: definition.tools,
    } as never,
  )
  return {
    generateText: async (ctx, target, args, options) =>
      await agent.generateText(ctx as never, target as never, args as never, options as never),
    streamText: async (ctx, target, args, options) =>
      await agent.streamText(ctx as never, target as never, args as never, options as never),
    continueThread: async (ctx, target) => {
      const { thread } = await agent.continueThread(ctx as never, target as never)
      return { thread: thread as ConvexAgentThreadSession }
    },
  }
}

async function fetchThreadContextSnapshot(request: ConvexAgentContextRequest): Promise<ConvexAgentContextSnapshot> {
  let captured: ConvexAgentContextSnapshot | undefined
  await fetchContextWithPrompt(
    request.ctx as never,
    request.component as never,
    {
      ...request.agentOptions,
      ...(request.options ?? {}),
      agentName: request.agentName,
      userId: request.target.userId ?? undefined,
      threadId: request.target.threadId,
      prompt: request.callArgs.prompt as never,
      messages: request.callArgs.messages as never,
      promptMessageId: stringValue(request.callArgs.promptMessageId),
      contextHandler: async (_handlerCtx: ConvexContextHandlerCtx, handlerArgs: ConvexContextHandlerArgs) => {
        captured = {
          all: contextMessages(handlerArgs.allMessages),
          search: contextMessages(handlerArgs.search),
          recent: contextMessages(handlerArgs.recent),
          inputMessages: contextMessages(handlerArgs.inputMessages),
          inputPrompt: contextMessages(handlerArgs.inputPrompt),
          existingResponses: contextMessages(handlerArgs.existingResponses),
          threadId: handlerArgs.threadId,
          userId: handlerArgs.userId,
        }
        return handlerArgs.allMessages
      },
    } as never,
  )

  if (!captured) {
    throw new Error('convexAgent().continueThread() could not inspect Convex Agent thread context before generation.')
  }
  return captured
}

function contextMessages(messages: readonly unknown[]): readonly ConvexAgentContextMessage[] {
  return messages.map((message) =>
    message && typeof message === 'object'
      ? {
          role: String((message as { role?: unknown }).role ?? ''),
          content: (message as { content?: unknown }).content,
        }
      : { role: '' },
  )
}
