import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSemanticIndexService,
  createTypeScriptSemanticBackend,
} from "../src/indexer/semantic/service";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("semantic request context planning evidence", () => {
  it("projects safe structure and conclusive composition findings", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/planning.ts");
    await writeFile(
      file,
      `
        import {
          Agent,
          context,
          droppable,
          history,
          offloadable,
          pipeline,
          prefer,
          prompt,
          summarizable,
        } from "@use-crux/core";

        const required = context({ id: "required", system: "PRIVATE_REQUIRED" });
        const compact = context({ id: "compact", system: "PRIVATE_COMPACT" });
        const elastic = context({ id: "elastic", system: "PRIVATE_ELASTIC" });

        export const writer = prompt({
          id: "writer",
          use: [
            required,
            droppable(offloadable(summarizable(prefer(elastic, compact)))),
            history(),
            history.recent(4),
            prefer(droppable(required), compact) as never,
          ],
        });

        export const writerAgent = new Agent({
          name: "writer-agent",
          prompt: writer,
          model: "provider:model",
          inputBudget: { optimizeAt: 800, max: 1_000 },
          prepareStep: () => ({ inputBudget: { max: 900 } }),
        });

        export const workflow = pipeline({
          id: "workflow",
          agents: [writerAgent],
          prepareInvocation: () => ({}),
        });
      `,
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });

    expect(patch.status).toBe("ok");
    const facts = patch.facts;
    expect(
      facts.definitions?.find((definition) => definition.id === "prompt:writer")
        ?.metadata?.facts,
    ).toMatchObject({
      contextPlanning: {
        history: { managed: 1, recent: 1 },
        contributions: [
          { index: 0, boundary: "required", wrappers: [] },
          {
            index: 1,
            boundary: "elastic",
            wrappers: ["droppable", "offloadable", "summarizable", "prefer"],
          },
          {
            index: 4,
            boundary: "elastic",
            wrappers: ["prefer", "droppable"],
          },
        ],
      },
    });
    expect(
      facts.definitions?.find(
        (definition) => definition.id === "agent:writer-agent",
      )?.metadata?.facts,
    ).toMatchObject({
      contextPlanning: {
        inputBudget: { scope: "definition", optimizeAt: 800, max: 1_000 },
        hooks: ["prepareStep"],
      },
    });
    expect(
      facts.definitions?.find(
        (definition) => definition.id === "composition.pipeline:workflow",
      )?.metadata?.facts,
    ).toMatchObject({
      contextPlanning: { hooks: ["prepareInvocation"] },
    });
    expect(facts.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: "agent:writer-agent",
          ref: expect.objectContaining({
            property: "inputBudget",
            role: "config",
          }),
        }),
        expect.objectContaining({
          definitionId: "agent:writer-agent",
          ref: expect.objectContaining({
            property: "prepareStep",
            role: "callback",
          }),
        }),
        expect.objectContaining({
          definitionId: "composition.pipeline:workflow",
          ref: expect.objectContaining({
            property: "prepareInvocation",
            role: "callback",
          }),
        }),
      ]),
    );
    expect(facts.lintFindings?.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "context-planning.history-cardinality",
        "context-planning.invalid-wrapper-order",
      ]),
    );
    expect(JSON.stringify(facts)).not.toMatch(/PRIVATE_/);
  });

  it("attaches invocation budget and step-hook overrides to their target", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/override.ts");
    await writeFile(
      file,
      `
        import { prompt } from "@use-crux/core";

        declare const executor: {
          generate(target: unknown, options: unknown): Promise<unknown>;
        };
        export const writer = prompt({ id: "writer" });
        export const result = executor.generate(writer, {
          inputBudget: { max: 2_000 },
          prepareStep: () => ({ inputBudget: { max: 1_500 } }),
        });
      `,
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });

    expect(patch.status).toBe("ok");
    expect(
      patch.facts.definitions?.find(
        (definition) => definition.id === "prompt:writer",
      )?.metadata?.facts,
    ).toMatchObject({
      contextPlanning: {
        overrides: { inputBudget: 1, prepareStep: 1 },
      },
    });
    expect(patch.facts.sourceRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          definitionId: "prompt:writer",
          ref: expect.objectContaining({
            property: "inputBudget",
            role: "config",
          }),
        }),
        expect.objectContaining({
          definitionId: "prompt:writer",
          ref: expect.objectContaining({
            property: "prepareStep",
            role: "callback",
          }),
        }),
      ]),
    );
  });

  it("ignores shadowed helpers when source identity is not canonical", async () => {
    const root = await fixtureRoot();
    const file = join(root, "src/shadowed.ts");
    await writeFile(
      file,
      `
        import { prompt } from "@use-crux/core";

        const history = Object.assign(() => ({}), { recent: () => ({}) });
        const droppable = (value: unknown) => value;
        export const writer = prompt({
          id: "writer",
          use: [history(), history.recent(), droppable(droppable({}))] as never,
        });
      `,
    );

    const patch = await createSemanticIndexService({
      backend: createTypeScriptSemanticBackend({ cache: "disabled" }),
    }).indexProject({ root, semanticBackend: "typescript" });

    const writer = patch.facts.definitions?.find(
      (definition) => definition.id === "prompt:writer",
    );
    expect(writer?.metadata?.facts).not.toHaveProperty("contextPlanning");
    expect(
      patch.facts.lintFindings?.some((finding) =>
        finding.ruleId.startsWith("context-planning."),
      ) ?? false,
    ).toBe(false);
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".tmp-context-planning-"));
  roots.push(root);
  await mkdir(join(root, "src"), { recursive: true });
  const scope = join(root, "node_modules/@use-crux");
  await mkdir(scope, { recursive: true });
  await symlink(join(process.cwd(), "../core"), join(scope, "core"), "dir");
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
  return root;
}
