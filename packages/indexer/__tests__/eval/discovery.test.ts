import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { discoverRuntimeEvalDefinitions } from "../../src/indexer/eval-discovery";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Eval Project Index discovery", () => {
  it("emits coordinator placement for an ordinary callable Eval", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/deterministic.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "export default evaluate({",
        "  id: 'deterministic',",
        "  task: async (input: string) => input.toUpperCase(),",
        "  cases: [{ input: 'hello' }],",
        "})",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.definitions[0]?.metadata).toMatchObject({
      requiredHostCapabilities: [],
      evalExecutionArms: [
        {
          name: "current",
          execution: "coordinator",
          requiredHostCapabilities: [],
        },
      ],
      facts: {
        kind: "eval",
        evalContract: "crux.eval",
        requiredHostCapabilities: [],
        evalExecutionArms: [
          {
            name: "current",
            execution: "coordinator",
            requiredHostCapabilities: [],
          },
        ],
      },
    });
  });

  it("emits managed host requirements from the discovered default Eval", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/support.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk',",
        "  capabilities: [], requiredHostCapabilities: ['record-store'], defaults: {}, overrideKeys: [],",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: { fixture: true } }),",
        "  execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => result.output,",
        "})",
        "export default evaluate({ id: 'support', task, cases: [{ input: {} }] })",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.definitions).toContainEqual(
      expect.objectContaining({
        id: "eval:support",
        kind: "eval",
        name: "support",
        source: expect.objectContaining({ file: source }),
        metadata: expect.objectContaining({
          exportName: "default",
          evalContract: "crux.eval",
          requiredHostCapabilities: ["record-store"],
        }),
      }),
    );
  });

  it("sorts mixed Current and Variant placement facts deterministically", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/mixed.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const hosted = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk',",
        "  capabilities: [], requiredHostCapabilities: ['record-store'], defaults: {}, overrideKeys: [],",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: { hosted: true } }),",
        "  execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => ({ output: result.output }),",
        "})",
        "const local = async (input: unknown) => input",
        "export default evaluate({",
        "  id: 'mixed', task: local, cases: [{ input: {} }],",
        "  variants: { zLocal: { task: local }, aRuntime: { task: hosted } } as never,",
        "})",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.definitions[0]?.metadata).toMatchObject({
      requiredHostCapabilities: ["record-store"],
      evalExecutionArms: [
        {
          name: "current",
          execution: "coordinator",
          requiredHostCapabilities: [],
        },
        {
          name: "aRuntime",
          execution: "runtime",
          requiredHostCapabilities: ["record-store"],
        },
        {
          name: "zLocal",
          execution: "coordinator",
          requiredHostCapabilities: [],
        },
      ],
    });
  });

  it("reports an incompatible task contract with Eval and source context", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/version-skew.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "const task = async (input: unknown) => input",
        "Object.defineProperty(task, Symbol.for('@use-crux/core/eval/task-descriptor'), {",
        "  value: { _tag: 'CruxEvalTaskDescriptor' },",
        "})",
        "export default evaluate({ id: 'version-skew', task, cases: [{ input: {} }] })",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "index.eval_task_contract_incompatible",
        message: expect.stringMatching(/version-skew.*compatible release/i),
        source: expect.objectContaining({ file: source }),
        relatedDefinitionIds: ["eval:version-skew"],
      }),
    );
  });

  it("reports an incompatible managed Variant replacement", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/replacement.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'",
        "const task = (call: string) => attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        "  _tag: 'CruxEvalTaskDescriptor', operation: 'generate', adapterId: 'ai-sdk', capabilities: [], requiredHostCapabilities: ['record-store'], defaults: {}, overrideKeys: [], callContractFingerprint: call,",
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }), execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output, projectResponse: (result: { output: unknown }) => result,",
        "})",
        "export default evaluate({ id: 'replacement', task: task('call-v1'), cases: [{ input: {} }], variants: { broken: { task: task('call-v2') } } })",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.definitions[0]?.metadata?.evalExecutionArms).toEqual([
      {
        name: "current",
        execution: "runtime",
        requiredHostCapabilities: ["record-store"],
      },
      {
        name: "broken",
        status: "invalid",
        code: "variant_invalid",
        reason:
          "planEval(): Variant 'broken' replacement task has an incompatible call contract.",
      },
    ]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "index.eval_variant_invalid",
        message: expect.stringMatching(
          /replacement.*broken.*incompatible call contract/i,
        ),
        source: expect.objectContaining({ file: source }),
        suggestedFix: expect.stringMatching(/fix Variant 'broken'/i),
      }),
    );
  });

  it("reports a non-callable task as an authored Eval error", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-eval-discovery-"));
    roots.push(root);
    const source = join(root, "evals/not-callable.eval.ts");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(
      source,
      [
        "import { evaluate } from '@use-crux/core/eval'",
        "export default evaluate({",
        "  id: 'not-callable', task: {} as never, cases: [{ input: {} }],",
        "})",
      ].join("\n"),
    );

    const result = await discoverRuntimeEvalDefinitions(
      root,
      ["**/*.eval.ts"],
      [],
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "error",
        code: "index.eval_task_not_callable",
        message: expect.stringMatching(/not-callable.*callable task/i),
        source: expect.objectContaining({ file: source }),
        relatedDefinitionIds: ["eval:not-callable"],
        suggestedFix: expect.stringContaining("evaluate()"),
      }),
    );
  });
});
