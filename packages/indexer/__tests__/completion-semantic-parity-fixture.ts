import type { SemanticBackendParityFixture } from "./semantic-backend-parity-fixtures";

/**
 * Exercises every first-party authored reference role admitted by completion.
 *
 * The semantic parity harness runs this fixture through both backends. This
 * keeps completion candidate kinds and source metadata backend-neutral without
 * coupling the request-time compiler to either semantic implementation.
 */
export const completionSemanticParityFixture = {
  name: "completion-admitted-reference-roles",
  workspacePackages: ["core", "mcp"],
  files: {
    "src/completion.ts": `
      import { context, prompt, tool } from '@use-crux/core'
      import { agent } from '@use-crux/core/agent'
      import { cascade, fallback, retry, router, split } from '@use-crux/core/routing'
      import { mcp, stdio } from '@use-crux/mcp'

      export const searchServer = mcp({
        id: 'search-server',
        transport: stdio({ command: 'search-server' }),
      })
      export const baseContext = context({ id: 'base-context' })
      export const searchTool = tool({ name: 'search' })
      export const sharedContext = context({
        id: 'shared-context',
        use: [baseContext, searchServer],
        tools: { searchTool },
      })
      export const writerPrompt = prompt({
        id: 'writer',
        use: [sharedContext, searchServer],
        tools: { searchTool },
      })
      export const reviewerAgent = agent({ id: 'reviewer', prompt: writerPrompt })
      export const retryRoute = retry(writerPrompt, { id: 'retry-route' })
      export const fallbackRoute = fallback([retryRoute, reviewerAgent], {
        id: 'fallback-route',
      })
      export const splitRoute = split({
        id: 'split-route',
        routes: { default: { model: writerPrompt, weight: 1 } },
      })
      export const cascadeRoute = cascade({
        id: 'cascade-route',
        tiers: [{ model: splitRoute }, { model: fallbackRoute }],
      })
      export const routerRoute = router({
        id: 'router-route',
        routes: {
          primary: { model: cascadeRoute },
          default: reviewerAgent,
        },
      })
      export const writerAgent = agent({
        id: 'writer-agent',
        prompt: writerPrompt,
        model: routerRoute,
        languageModel: fallbackRoute,
        tools: { searchTool },
        handoffs: ['reviewer'],
      })
    `,
  },
  expect: {
    relationTypes: [
      "agent.uses_prompt",
      "agent.uses_routing",
      "agent.uses_tool",
      "agent.can_handoff_to",
      "context.uses_context",
      "context.uses_mcp_server",
      "context.uses_tool",
      "prompt.uses_context",
      "prompt.uses_mcp_server",
      "prompt.uses_tool",
      "retry.target.uses_prompt",
      "fallback.option.uses_retry",
      "fallback.option.uses_agent",
      "split.route.uses_prompt",
      "cascade.tier.uses_split",
      "cascade.tier.uses_fallback",
      "router.route.uses_cascade",
      "router.route.uses_agent",
    ],
    sourceRefRoles: ["config"],
  },
} as const satisfies SemanticBackendParityFixture;
