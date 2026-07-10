import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IndexPatchFacts } from "../indexer/patches";
import {
  createNativeSemanticBackend,
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../indexer/semantic/service";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-semantic-native-direct-"),
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("native semantic direct Crux projectors", () => {
  it("matches TypeScript facts for source refs", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/source-refs.ts");
    await writeFile(
      file,
      `
        import { context, prompt, tool } from '@use-crux/core'

        const WRITER_SYSTEM = 'Write clearly.'
        function renderPrompt(input: { topic: string }) {
          return 'Draft ' + input.topic
        }
        function resolveContext() {
          return { locale: 'en' }
        }
        function renderContext() {
          return 'Use the active locale.'
        }
        function shouldUseContext() {
          return true
        }
        async function executeSearch() {
          return {}
        }

        export const localeContext = context({
          id: 'locale',
          system: WRITER_SYSTEM,
          resolve: resolveContext,
          render: renderContext,
          when: shouldUseContext,
        })
        export const searchTool = tool({ name: 'search', execute: executeSearch })
        export const writerPrompt = prompt({
          id: 'writer-source-refs',
          system: WRITER_SYSTEM,
          prompt: renderPrompt,
          use: [localeContext],
          tools: { searchTool },
        })
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);

  it("matches TypeScript facts for context dependencies", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/context-dependencies.ts");
    await writeFile(
      file,
      `
        import { context, tool } from '@use-crux/core'

        export const baseContext = context({ id: 'base' })
        export const helperTool = tool({ name: 'helper' })
        export const writerContext = context({
          id: 'writer-context',
          use: [baseContext],
          tools: { helperTool },
        })
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);

  it("matches TypeScript facts for agent config refs", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/agent-config.ts");
    await writeFile(
      file,
      `
        import { agent, prompt, tool } from '@use-crux/core'

        function contextHandler() {
          return {}
        }
        function usageHandler() {
          return {}
        }
        function prepare() {
          return {}
        }

        export const writerPrompt = prompt({ id: 'writer' })
        export const searchTool = tool({ name: 'search' })
        export const writerAgent = agent({
          id: 'writer-agent',
          prompt: writerPrompt,
          tools: { searchTool },
          handoffs: ['reviewer-agent', { id: 'editor-agent', when: 'Needs editing' }],
          contextHandler,
          usageHandler,
          prepare,
        })
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);

  it("matches TypeScript facts for routing primitives", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/routing.ts");
    await writeFile(
      file,
      `
        import { agent, prompt } from '@use-crux/core'
        import { cascade, fallback, retry, router, split } from '@use-crux/core/routing'

        function classifyRoute(input: { kind?: string }) {
          return input.kind === 'draft' ? 'draft' : 'default'
        }
        function accepted() {
          return true
        }
        function shouldFallback() {
          return true
        }
        function onAttemptError() {
          return undefined
        }
        function seedSession() {
          return 'session-1'
        }

        export const writerPrompt = prompt({ id: 'writer-routing' })
        export const writerAgent = agent({ id: 'writer-routing-agent', prompt: writerPrompt })
        export const retriedWriter = retry(writerAgent, { id: 'retried-writer', attempts: 2 })
        export const resilientWriter = fallback([retriedWriter, writerPrompt], {
          id: 'resilient-writer',
          when: shouldFallback,
          onFallback: onAttemptError,
        })
        export const canarySplit = split({
          id: 'canary-split',
          seed: seedSession,
          routes: {
            stable: { model: writerAgent, weight: 95 },
            canary: { model: writerPrompt, weight: 5 },
          },
        })
        export const qualityCascade = cascade({
          id: 'quality-routing',
          tiers: [
            { model: canarySplit, evaluate: accepted },
            { model: resilientWriter },
          ],
        })
        export const qualityRouter = router({
          id: 'quality-router',
          classify: classifyRoute,
          routes: {
            draft: { model: qualityCascade, maxTokens: 1200 },
            default: resilientWriter,
          },
        })
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);

  it("matches TypeScript facts for agent routing models", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/agent-routing.ts");
    await writeFile(
      file,
      `
        import { agent, prompt } from '@use-crux/core'
        import { fallback, router } from '@use-crux/core/routing'

        export const writerPrompt = prompt({ id: 'writer-route-target' })
        export const backupPrompt = prompt({ id: 'backup-route-target' })
        export const resilientWriter = fallback(writerPrompt, backupPrompt, { id: 'resilient-writer' })
        export const qualityRouter = router({
          id: 'quality-router',
          routes: { default: resilientWriter },
        })
        export const routedAgent = agent({
          id: 'routed-agent',
          model: qualityRouter,
          languageModel: resilientWriter,
        })
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);

  it("matches TypeScript facts for storage definitions and bundle wiring", async () => {
    const root = await fixtureRoot();
    await writeTsconfig(root);
    const file = join(root, "src/storage.ts");
    await writeFile(
      file,
      `
        import {
          inMemoryBlobStore,
          inMemoryRecordStore,
          inMemoryVectorStore,
          storage,
        } from '@use-crux/core/storage'

        export const records = inMemoryRecordStore()
        export const vectors = inMemoryVectorStore()
        export const blobs = inMemoryBlobStore()
        export const appStorage = storage({ records, vectors, blobs })
        export const tenantStorage = storage.scope(appStorage, 'tenant-a')
      `,
    );

    await expectDirectNativeParity(root, file);
  }, 20_000);
});

async function expectDirectNativeParity(
  root: string,
  file: string,
): Promise<void> {
  const timingNames: string[] = [];
  const coverageExtractors: string[][] = [];
  const typescriptPatch = await createSemanticIndexService({
    backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
  }).indexFiles({ root, files: [file] });
  const nativePatch = await createSemanticIndexService({
    backend: createNativeSemanticBackend({ cache: "disabled" }),
  }).indexFiles({
    root,
    files: [file],
    semanticInstrumentation: {
      onTiming: (timing) => timingNames.push(timing.name),
      onNativeCoverage: (coverage) =>
        coverageExtractors.push(
          "extractors" in coverage ? [...coverage.extractors] : [],
        ),
    },
  });

  expect(typescriptPatch.status).toBe("ok");
  expect(nativePatch.status).toBe("ok");
  expect(normalizedFacts(nativePatch.facts)).toEqual(
    normalizedFacts(typescriptPatch.facts),
  );
  expect(timingNames).toContain("semantic.native.extractor.direct_crux");
  expect(timingNames).not.toContain("semantic.native.analyzer.shared");
  expect(coverageExtractors).toEqual([["crux.direct-crux"]]);
}

async function writeTsconfig(root: string): Promise<void> {
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ESNext",
        moduleResolution: "Bundler",
        target: "ES2022",
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
}

function normalizedFacts(facts: IndexPatchFacts): IndexPatchFacts {
  return {
    definitions: sortJsonRows(facts.definitions),
    sourceRefs: sortJsonRows(facts.sourceRefs),
    relations: sortJsonRows(facts.relations),
    diagnostics: sortJsonRows(facts.diagnostics),
    lintFindings: sortJsonRows(facts.lintFindings),
    sources: sortJsonRows(facts.sources),
    sourceGraph: facts.sourceGraph,
  };
}

function sortJsonRows<T>(rows: readonly T[] | undefined): T[] | undefined {
  return rows
    ? [...rows].sort((left, right) =>
        JSON.stringify(left).localeCompare(JSON.stringify(right)),
      )
    : undefined;
}
