import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStaticExtraction } from "../indexer/static/extraction/engine";
import { createTypeScriptStaticSyntaxFrontend } from "../indexer/static-index/syntax";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("static extraction engine fact projection", () => {
  it("projects extracted facts into index definitions, relations, and dependencies", async () => {
    const root = await fixtureRoot();
    const sourceFile = join(root, "src/index.ts");
    const importedFile = join(root, "src/shared.ts");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      importedFile,
      fixtureSource(`
        export const importedPrompt = prompt({ id: 'imported' })
        export const importedContext = context({ id: 'importedContext' })
        export const importedTool = tool({ name: 'importedTool' })
      `),
    );
    await writeFile(
      sourceFile,
      fixtureSource(`
        import { importedPrompt, importedTool } from './shared'

        export const exportedTool = tool({ name: 'exportedTool' })
        export const seoInjectable = injectable({
          id: 'seo',
          input: schema,
          inject: () => ({
            contexts: [importedContext],
            tools: { importedTool },
          }),
        })
        export const exportedContext = context({
          id: 'exportedContext',
          input: z.object({ locale: z.string() }),
          use: [when(() => true, seoInjectable), memory],
          tools: { exportedTool },
        })
        export const exportedPrompt = prompt({
          id: 'exported',
          input: z.object({ brief: z.string() }),
          use: [
            exportedContext,
            match({
              on: () => 'default',
              cases: { imported: importedContext },
              default: seoInjectable,
            }),
          ],
          tools: { importedTool },
        })
        export const exportedAgent = agent({
          id: 'exportedAgent',
          prompt: importedPrompt,
          tools: [importedTool, exportedTool],
        })
        export const exportedRouter = router({
          id: 'router',
          routes: { main: exportedAgent },
          classify,
        })
        export const exportedFlow = flow('draft', async (step) => {
          await step.step('write', exportedAgent)
        })

        const localPrompt = prompt({ id: 'local' })
        const localAgent = new Agent({ name: 'Local Agent', prompt: localPrompt })
        tool({ name: 'inlineTool' })

        export const promptTree = createPrompts({ nested: { imported: importedPrompt, local: localPrompt } })
      `),
    );

    const projected = await createStaticExtraction({
      root,
      syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
      cache: "none",
    }).extractFile(sourceFile);

    expect(projected.dependencies).toEqual([importedFile]);
    expect(projected.definitions.map((definition) => definition.id)).toEqual(
      expect.arrayContaining([
        "context:exportedContext",
        "prompt:exported",
        "injectable:seo",
        "tool:exportedTool",
        "agent:exportedAgent",
        "routing.router:router",
        "flow:draft",
        "prompt:local",
        "agent:Local-Agent",
        "tool:inlineTool",
        "prompt:imported",
      ]),
    );
    expect(
      byId(projected.definitions, "injectable:seo")?.metadata?.facts,
    ).toEqual(
      expect.objectContaining({
        kind: "injectable",
        mayInject: expect.arrayContaining(["contexts", "tools"]),
        useEntries: expect.arrayContaining([
          expect.objectContaining({ variable: "importedContext" }),
        ]),
      }),
    );
    expect(projected.relations.map((relation) => relation.type)).toEqual(
      expect.arrayContaining([
        "prompt.uses_context",
        "prompt.uses_injectable",
        "prompt.uses_tool",
        "context.uses_injectable",
        "context.uses_memory",
        "context.uses_tool",
        "injectable.uses_context",
        "injectable.uses_tool",
        "agent.uses_prompt",
        "agent.uses_tool",
        "router.includes_route",
        "router.route.uses_agent",
        "flow.includes_step",
        "flow.step.uses_agent",
      ]),
    );
    expect(
      projected.definitions.some(
        (definition) =>
          definition.id === "prompt:imported" &&
          definition.path?.join("/") === "nested/imported",
      ),
    ).toBe(true);
    expect(
      byId(projected.definitions, "prompt:exported")?.metadata?.intelligence
        ?.dependencies,
    ).toEqual(
      expect.objectContaining({
        contexts: expect.arrayContaining(["context:exportedContext"]),
        injectables: expect.arrayContaining(["injectable:seo"]),
        tools: expect.arrayContaining(["tool:importedTool"]),
      }),
    );
    const exportedPromptFacts = byId(projected.definitions, "prompt:exported")
      ?.metadata?.facts;
    expect(exportedPromptFacts?.kind).toBe("prompt");
    expect(
      exportedPromptFacts?.kind === "prompt"
        ? exportedPromptFacts.tools
        : undefined,
    ).toEqual(
      expect.objectContaining({
        hasTools: true,
        names: expect.arrayContaining(["importedTool"]),
        variables: expect.arrayContaining(["importedTool"]),
      }),
    );
    const promptContract = byId(projected.definitions, "prompt:exported")
      ?.metadata?.intelligence?.contract;
    expect(promptContract?.inputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({ brief: expect.any(Object) }),
      }),
    );
    expect(promptContract?.expandedInputSchema).toEqual(
      expect.objectContaining({
        properties: expect.objectContaining({
          brief: expect.any(Object),
          locale: expect.any(Object),
          value: expect.any(Object),
        }),
        required: expect.arrayContaining(["brief", "locale"]),
      }),
    );
    expect(promptContract?.expandedInputSchema?.required).not.toContain(
      "value",
    );
    expect(promptContract?.inputContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "locale",
          sourceDefinitionId: "context:exportedContext",
          conditionality: "always",
          required: true,
        }),
        expect.objectContaining({
          field: "value",
          sourceDefinitionId: "injectable:seo",
          conditionality: "match-default",
          branch: "default",
          required: false,
        }),
      ]),
    );
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-extension-parity-"));
  roots.push(root);
  return root;
}

function fixtureSource(source: string): string {
  return `
    const schema = z.object({ value: z.string() })
    const systemText = 'system'

    function resolve() { return 'ctx' }
    function execute() { return memory.get('x') }
    function classify() { return 'default' }

    const ctx = context({ id: 'ctx' })
    const writingPrompt = prompt({ id: 'writing' })
    const searchTool = tool({ name: 'search' })
    const writer = agent({ id: 'writer' })
    const editor = agent({ id: 'editor' })
    const memory = memory({ id: 'mem' })
    const docs = retriever({ id: 'docs' })
    const judge = llmJudge({ id: 'judge' })

    ${source}
  `;
}

function byId<T extends { id: string }>(
  items: readonly T[],
  id: string,
): T | undefined {
  return items.find((item) => item.id === id);
}
