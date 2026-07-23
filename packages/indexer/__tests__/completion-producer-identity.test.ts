import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

describe("static completion producer identity", () => {
  itWithRustOxc(
    "stamps direct exports for every approved module-qualified producer",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: approvedProducerFixture,
        callNames: [
          "agent",
          "cascade",
          "context",
          "convexAgent",
          "createTool",
          "fallback",
          "mcp",
          "prompt",
          "retry",
          "router",
          "split",
          "tool",
        ],
        constructorNames: ["Agent"],
      });

      for (const id of approvedDefinitionIds) {
        expect(
          nativeOut.definitions.find((definition) => definition.id === id),
          id,
        ).toMatchObject({ metadata: { exported: true } });
      }
    },
    30_000,
  );

  itWithRustOxc(
    "rejects local, wrong-module, wrapper, and local-constructor impostors",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: rejectedProducerFixture,
        additionalFiles: [
          {
            path: "src/wrapper.ts",
            source: "export { agent } from '@use-crux/core/agent'",
          },
        ],
        callNames: ["agent"],
        constructorNames: ["Agent"],
      });

      for (const id of [
        "agent:local",
        "agent:wrong-module",
        "agent:wrapped",
        "agent:local-constructor",
      ]) {
        expect(
          nativeOut.definitions.find((definition) => definition.id === id)
            ?.metadata?.["exported"],
          id,
        ).toBeUndefined();
      }
      expect(
        nativeOut.definitions.find(
          (definition) => definition.name === "aliased-local",
        ),
      ).toBeUndefined();
    },
    30_000,
  );

  itWithRustOxc(
    "keeps structural tool-schema export proof independent of call identity",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: `
          export const schemaTool = {
            name: 'schema-tool',
            description: 'A structurally proven tool',
            input: { type: 'object', properties: {} },
          }
          export const ordinaryObject = {
            name: 'not-a-tool',
            description: 'Missing a schema property',
          }
        `,
        callNames: ["tool", "createTool"],
      });

      expect(
        nativeOut.definitions.find(
          (definition) => definition.id === "tool:schema-tool",
        ),
      ).toMatchObject({ metadata: { exported: true } });
      expect(
        nativeOut.definitions.find(
          (definition) => definition.name === "not-a-tool",
        ),
      ).toBeUndefined();
    },
    30_000,
  );
});

const approvedDefinitionIds = [
  "agent:core-agent",
  "agent:aliased-agent",
  "agent:convex-root",
  "agent:convex-subpath",
  "agent:convex-new",
  "context:core-context",
  "mcp.server:core-mcp",
  "prompt:core-prompt",
  "routing.cascade:core-cascade",
  "routing.fallback:root-fallback",
  "routing.fallback:routing-fallback",
  "routing.retry:core-retry",
  "routing.router:core-router",
  "routing.split:core-split",
  "tool:core-tool",
  "tool:subpath-tool",
  "tool:convex-tool",
] as const;

const approvedProducerFixture = `
  import {
    context,
    fallback as rootFallback,
    prompt,
    tool,
  } from '@use-crux/core'
  import { agent, agent as defineAgent } from '@use-crux/core/agent'
  import {
    cascade,
    fallback as routingFallback,
    retry,
    router,
    split,
  } from '@use-crux/core/routing'
  import { tool as toolsTool } from '@use-crux/core/tools'
  import { convexAgent as rootConvexAgent } from '@use-crux/convex'
  import {
    Agent,
    convexAgent as subpathConvexAgent,
    createTool,
  } from '@use-crux/convex/agent'
  import { mcp } from '@use-crux/mcp'

  export const coreContext = context({ id: 'core-context' })
  export const coreTool = tool({ name: 'core-tool' })
  export const subpathTool = toolsTool({ name: 'subpath-tool' })
  export const corePrompt = prompt({ id: 'core-prompt' })
  export const coreAgent = agent({ id: 'core-agent', prompt: corePrompt })
  export const aliasedAgent = defineAgent({ id: 'aliased-agent' })
  export const coreRetry = retry(corePrompt, { id: 'core-retry' })
  export const rootFallbackRoute = rootFallback([corePrompt], {
    id: 'root-fallback',
  })
  export const routingFallbackRoute = routingFallback([corePrompt], {
    id: 'routing-fallback',
  })
  export const coreSplit = split({
    id: 'core-split',
    routes: { default: { model: corePrompt, weight: 1 } },
  })
  export const coreCascade = cascade({
    id: 'core-cascade',
    tiers: [{ model: corePrompt }],
  })
  export const coreRouter = router({
    id: 'core-router',
    routes: { default: corePrompt },
  })
  export const coreMcp = mcp({ id: 'core-mcp' })
  export const convexRoot = rootConvexAgent({ name: 'convex-root' })
  export const convexSubpath = subpathConvexAgent({ name: 'convex-subpath' })
  export const convexNew = new Agent({ name: 'convex-new' })
  export const convexTool = createTool({ name: 'convex-tool' })
`;

const rejectedProducerFixture = `
  import { agent as wrongModuleAgent } from '@acme/agent'
  import { agent as wrappedAgent } from './wrapper'

  function agent(config: { id: string }) {
    return config
  }
  class Agent {
    constructor(readonly config: { name: string }) {}
  }
  const aliasedToLocal = agent

  export const local = agent({ id: 'local' })
  export const wrongModule = wrongModuleAgent({ id: 'wrong-module' })
  export const wrapped = wrappedAgent({ id: 'wrapped' })
  export const aliasedLocal = aliasedToLocal({ id: 'aliased-local' })
  export const localConstructor = new Agent({ name: 'local-constructor' })
`;
