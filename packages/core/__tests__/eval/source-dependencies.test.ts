import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintEvalSourceClosure } from "../../src/eval/node/source-dependencies";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Eval source dependency identity", () => {
  it("canonicalizes entry identity without hiding imported source edits", async () => {
    const root = await project();
    const entryFile = "evals/support.eval.ts";
    const canonicalEntrySource =
      'import { task } from "../task";\ncaseFile("evals/fixtures/refunds.json");\n';
    await source(
      root,
      entryFile,
      'import { task } from "../task";\ncaseFile("./fixtures/../fixtures/refunds.json");\n',
    );
    await source(root, "task.ts", 'export const task = "v1";\n');

    const identityInput = {
      projectRoot: root,
      entryFile,
      entryIdentitySource: canonicalEntrySource,
    } as Parameters<typeof fingerprintEvalSourceClosure>[0] & {
      entryIdentitySource: string;
    };
    const first = await fingerprintEvalSourceClosure(identityInput);
    await source(
      root,
      entryFile,
      'import { task } from "../task";\ncaseFile("./fixtures/refunds.json");\n',
    );
    const equivalent = await fingerprintEvalSourceClosure(identityInput);
    await source(root, "task.ts", 'export const task = "v2";\n');
    const importedEdit = await fingerprintEvalSourceClosure(identityInput);

    expect(equivalent.fingerprint).toBe(first.fingerprint);
    expect(importedEdit.fingerprint).not.toBe(first.fingerprint);
  });

  it("changes only when the Eval's transitive authored source changes", async () => {
    const root = await project();
    await source(
      root,
      "evals/support.eval.ts",
      'import { supportPrompt } from "../prompts/support";\nexport default supportPrompt;\n',
    );
    await source(
      root,
      "prompts/support.ts",
      'import { tone } from "./tone";\nexport const supportPrompt = () => tone;\n',
    );
    await source(root, "prompts/tone.ts", 'export const tone = "friendly";\n');

    const first = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    const unchanged = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    await source(root, "prompts/tone.ts", 'export const tone = "direct";\n');
    const changed = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });

    expect(first).toMatchObject({
      reusable: true,
      dependencies: [
        "project:evals/support.eval.ts",
        "project:prompts/support.ts",
        "project:prompts/tone.ts",
      ],
    });
    expect(unchanged.fingerprint).toBe(first.fingerprint);
    expect(changed.fingerprint).not.toBe(first.fingerprint);
  });

  it("fails closed when a dynamic dependency cannot be resolved statically", async () => {
    const root = await project();
    await source(
      root,
      "evals/support.eval.ts",
      "export const loadPrompt = (name: string) => import(`../prompts/${name}`);\n",
    );

    await expect(
      fingerprintEvalSourceClosure({
        projectRoot: root,
        entryFile: "evals/support.eval.ts",
      }),
    ).resolves.toMatchObject({
      reusable: false,
      reason: "unresolved_source_dependency",
      issues: [expect.stringMatching(/dynamic import.*string literal/i)],
    });
  });

  it("marks function-form Variant task bindings untracked", async () => {
    const root = await project();
    await source(
      root,
      "evals/support.eval.ts",
      'import { createTask, task } from "../task";\nexport default evaluate({ task, variants: { inline: { task: createTask("v2") } } });\n',
    );
    await source(
      root,
      "task.ts",
      "export const task = {}; export const createTask = (_version: string) => ({});\n",
    );

    await expect(
      fingerprintEvalSourceClosure({
        projectRoot: root,
        entryFile: "evals/support.eval.ts",
      }),
    ).resolves.toMatchObject({
      reusable: true,
      hasUntrackedTaskBindings: true,
      taskSourceFingerprint: expect.any(String),
    });
  });

  it("isolates imported task source identity by selected Variant binding", async () => {
    const root = await project();
    await source(
      root,
      "evals/support.eval.ts",
      'import { currentTask } from "../current-task";\nimport { candidateTask } from "../candidate-task";\nexport default evaluate({ task: currentTask, variants: { candidate: { task: candidateTask } } });\n',
    );
    await source(root, "current-task.ts", 'export const currentTask = "v1";\n');
    await source(
      root,
      "candidate-task.ts",
      'export const candidateTask = "v1";\n',
    );

    const first = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    await source(
      root,
      "candidate-task.ts",
      'export const candidateTask = "v2";\n',
    );
    const changed = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    const firstBindings = (
      first as typeof first & {
        taskSourceFingerprints?: Readonly<Record<string, string>>;
      }
    ).taskSourceFingerprints;
    const changedBindings = (
      changed as typeof changed & {
        taskSourceFingerprints?: Readonly<Record<string, string>>;
      }
    ).taskSourceFingerprints;

    expect(firstBindings).toMatchObject({
      current: expect.any(String),
      candidate: expect.any(String),
    });
    expect(changedBindings?.current).toBe(firstBindings?.current);
    expect(changedBindings?.candidate).not.toBe(firstBindings?.candidate);
  });

  it("fails closed when an outside source has no portable workspace identity", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "crux-eval-source-"));
    roots.push(workspace);
    const root = join(workspace, "app");
    await source(
      workspace,
      "app/evals/support.eval.ts",
      'export { prompt } from "../../shared/prompt";\n',
    );
    await source(
      workspace,
      "shared/prompt.ts",
      'export const prompt = "hi";\n',
    );

    await expect(
      fingerprintEvalSourceClosure({
        projectRoot: root,
        entryFile: "evals/support.eval.ts",
      }),
    ).resolves.toMatchObject({
      reusable: false,
      reason: "unresolved_source_dependency",
      issues: [expect.stringMatching(/portable workspace identity/i)],
    });
  });

  it("uses portable package-relative identities through workspace symlinks", async () => {
    const one = await workspaceProject();
    const two = await workspaceProject();

    const first = await fingerprintEvalSourceClosure({
      projectRoot: one,
      entryFile: "evals/support.eval.ts",
    });
    const second = await fingerprintEvalSourceClosure({
      projectRoot: two,
      entryFile: "evals/support.eval.ts",
    });

    expect(first).toMatchObject({
      reusable: true,
      dependencies: [
        "project:evals/support.eval.ts",
        "workspace:@acme/prompts:src/index.ts",
        "workspace:@acme/prompts:src/tone.ts",
      ],
    });
    expect(second.fingerprint).toBe(first.fingerprint);
  });

  it("does not hash installed package internals into authored identity", async () => {
    const root = await project();
    await source(
      root,
      "evals/support.eval.ts",
      'import "installed-prompt-runtime";\nexport const prompt = "hi";\n',
    );
    await source(
      root,
      "node_modules/installed-prompt-runtime/package.json",
      '{"name":"installed-prompt-runtime","version":"1.0.0","main":"index.js"}',
    );
    await source(
      root,
      "node_modules/installed-prompt-runtime/index.js",
      'import "./internal.js";\n',
    );
    await source(
      root,
      "node_modules/installed-prompt-runtime/internal.js",
      'export const implementation = "external";\n',
    );

    const first = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    await source(
      root,
      "node_modules/installed-prompt-runtime/internal.js",
      'export const implementation = "changed without a release";\n',
    );
    const implementationChanged = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });
    await source(
      root,
      "node_modules/installed-prompt-runtime/package.json",
      '{"name":"installed-prompt-runtime","version":"2.0.0","main":"index.js"}',
    );
    const versionChanged = await fingerprintEvalSourceClosure({
      projectRoot: root,
      entryFile: "evals/support.eval.ts",
    });

    expect(first).toMatchObject({
      reusable: true,
      dependencies: [
        "project:evals/support.eval.ts",
        "external:installed-prompt-runtime@1.0.0:installed-prompt-runtime:index.js",
      ],
    });
    expect(implementationChanged.fingerprint).toBe(first.fingerprint);
    expect(versionChanged.fingerprint).not.toBe(first.fingerprint);
  });
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), ".eval-source-"));
  roots.push(root);
  return root;
}

async function source(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const { dirname } = await import("node:path");
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

async function workspaceProject(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "crux-eval-workspace-"));
  roots.push(workspace);
  const app = join(workspace, "apps/app");
  await source(
    workspace,
    "apps/app/evals/support.eval.ts",
    'import { prompt } from "@acme/prompts";\nexport default prompt;\n',
  );
  await source(
    workspace,
    "packages/prompts/package.json",
    '{"name":"@acme/prompts","type":"module","exports":{".":{"import":"./src/index.ts"}}}',
  );
  await source(
    workspace,
    "packages/prompts/src/index.ts",
    '// This is the surface the root barrel re-exports. Other files stay private.\nexport { tone as prompt } from "./tone";\n',
  );
  await source(
    workspace,
    "packages/prompts/src/tone.ts",
    'export const tone = "friendly";\n',
  );
  await mkdir(join(app, "node_modules/@acme"), { recursive: true });
  await symlink(
    join(workspace, "packages/prompts"),
    join(app, "node_modules/@acme/prompts"),
    "dir",
  );
  return app;
}
