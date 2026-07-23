import type { ProjectDefinition } from "@use-crux/core/project-index";
import { describe, expect } from "vitest";
import {
  extractNativeAndFallback,
  itWithRustOxc,
} from "./native-first-party-fixture-helpers";

describe("completion candidate backend parity", () => {
  itWithRustOxc(
    "exposes kind, source, and export metadata for every admitted candidate kind",
    async () => {
      const { fallbackOut, nativeOut, typescriptOut } =
        await extractNativeAndFallback({
        source: candidateFixture,
        callNames: [
          "agent",
          "context",
          "mcp",
          "prompt",
          "tool",
          "router",
          "split",
          "retry",
          "cascade",
          "fallback",
        ],
      });

      const nativeCandidates = candidateFacts(nativeOut.definitions);
      expect(nativeCandidates).toHaveLength(admittedCandidateKinds.length + 1);
      const extensionCandidates = nativeCandidates.filter(
        (candidate) => candidate.kind === "mcp.server",
      );
      expect(candidateFacts(fallbackOut.definitions)).toEqual(
        extensionCandidates,
      );
      expect(candidateFacts(typescriptOut.definitions)).toEqual(
        extensionCandidates,
      );

      for (const kind of admittedCandidateKinds) {
        const definition = nativeCandidates.find(
          (candidate) =>
            candidate.kind === kind && candidate.name !== "local-prompt",
        );
        expect(definition, kind).toBeDefined();
        expect(definition?.file, `${kind} source file`).toMatch(
          /src\/fixture\.ts$/,
        );
        expect(definition?.line, `${kind} source line`).toBeGreaterThan(0);
        expect(definition?.exportName, `${kind} named export`).toEqual(
          expect.any(String),
        );
        expect(definition?.exported, `${kind} direct export proof`).toBe(true);
      }
      expect(
        nativeCandidates.find(
          (candidate) => candidate.name === "local-prompt",
        ),
      ).toMatchObject({ exportName: "localPrompt", exported: undefined });
    },
    30_000,
  );

  itWithRustOxc(
    "does not export-prove a same-name non-first-party definition",
    async () => {
      const { nativeOut } = await extractNativeAndFallback({
        source: `
          function agent(config: { id: string }) {
            return config
          }
          export const impostor = agent({ id: 'impostor' })
        `,
        callNames: ["agent"],
      });

      const impostor = nativeOut.definitions.find(
        (definition) => definition.id === "agent:impostor",
      );
      expect(impostor?.metadata?.["exportName"]).toBe("impostor");
      expect(impostor?.metadata?.["exported"]).toBeUndefined();
    },
    30_000,
  );
});

const admittedCandidateKinds = [
  "agent",
  "context",
  "mcp.server",
  "prompt",
  "tool",
  "routing.router",
  "routing.split",
  "routing.retry",
  "routing.cascade",
  "routing.fallback",
] as const;

const candidateFixture = `
  import { context, prompt, tool } from '@use-crux/core'
  import { agent } from '@use-crux/core/agent'
  import { mcp, stdio } from '@use-crux/mcp'
  import { cascade, fallback, retry, router, split } from '@use-crux/core/routing'

  export const searchServer = mcp({
    id: 'search-server',
    transport: stdio({ command: 'search-server' }),
  })
  export const brandContext = context({ id: 'brand' })
  export const searchTool = tool({ name: 'search' })
  const localPrompt = prompt({ id: 'local-prompt' })
  export const writerPrompt = prompt({
    id: 'writer',
    use: [brandContext, searchServer],
    tools: { searchTool },
  })
  export const writerAgent = agent({
    id: 'writer-agent',
    prompt: writerPrompt,
    tools: { searchTool },
  })
  export const retryRoute = retry(writerPrompt, { id: 'retry-route' })
  export const fallbackRoute = fallback([retryRoute, writerAgent], {
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
      default: writerAgent,
    },
  })
`;

function candidateFacts(definitions: readonly ProjectDefinition[]) {
  return definitions
    .filter((definition) =>
      admittedCandidateKinds.includes(
        definition.kind as (typeof admittedCandidateKinds)[number],
      ),
    )
    .map((definition) => ({
      kind: definition.kind,
      name: definition.name,
      file: definition.source?.file,
      line: definition.source?.line,
      exportName: definition.metadata?.["exportName"],
      exported: definition.metadata?.["exported"],
    }))
    .sort((left, right) =>
      `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`),
    );
}
