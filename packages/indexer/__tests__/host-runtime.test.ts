import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { indexProjectRuntimeForHost, loadRuntimeWorkerHost } from "../src/host/runtime";

const roots: string[] = [];
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime-rich host indexing", () => {
  it("loads the configured in-process Runtime host for a worker", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "export default {",
        "  config: { runtime: { kind: 'in-process', id: 'fixture', store: { maintenanceOwnership: { acquire() {} } }, capabilities: {}, createWake() {} } },",
        "  prompts: [], contexts: [], get() {},",
        "}",
      ].join("\n"),
    );

    await expect(loadRuntimeWorkerHost({ root })).resolves.toMatchObject({ id: "fixture" });
  });

  it("rejects an in-process Runtime without durable maintenance ownership", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    await writeFile(
      join(root, "crux.config.ts"),
      [
        "export default {",
        "  config: { runtime: { kind: 'in-process', id: 'memory', store: {}, capabilities: {}, createWake() {} } },",
        "  prompts: [], contexts: [], get() {},",
        "}",
      ].join("\n"),
    );

    await expect(loadRuntimeWorkerHost({ root })).rejects.toMatchObject({
      code: "CAPABILITY_MISSING",
      nextStep: expect.stringContaining("node({ store: postgres() })"),
    });
  });

  it("keeps an unrecognized config export on the missing Runtime path", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    await writeFile(join(root, "crux.config.ts"), "export default {}\n");

    await expect(loadRuntimeWorkerHost({ root })).rejects.toMatchObject({
      code: "RUNTIME_REQUIRED",
    });
  });

  it("reports an unresolved config import as an import failure", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    await writeFile(
      join(root, "crux.config.ts"),
      "import './missing-runtime-config'\nexport default {}\n",
    );

    await expect(loadRuntimeWorkerHost({ root })).rejects.toMatchObject({
      code: "RUNTIME_ARTIFACT_MANIFEST_INVALID",
    });
  });

  it("adds execution placement for authored Evals to the runtime patch", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
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

    const patch = await runtimePatch(root);

    expect(patch.facts.definitions).toContainEqual(
      expect.objectContaining({
        id: "eval:deterministic",
        metadata: expect.objectContaining({
          evalExecutionArms: [
            {
              name: "current",
              execution: "coordinator",
              requiredHostCapabilities: [],
            },
          ],
        }),
      }),
    );
  });

  it("imports multiple Evals concurrently through one shared module identity", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    const evals = join(root, "evals");
    await mkdir(evals, { recursive: true });
    await writeFile(
      join(evals, "barrier.ts"),
      [
        "let arrived = 0",
        "let release!: () => void",
        "const ready = new Promise<void>((resolve) => { release = resolve })",
        "export async function rendezvous() {",
        "  arrived += 1",
        "  if (arrived === 2) release()",
        "  await ready",
        "}",
      ].join("\n"),
    );
    await Promise.all(
      ["alpha", "beta"].map((id) =>
        writeFile(
          join(evals, `${id}.eval.ts`),
          [
            "import { evaluate } from '@use-crux/core/eval'",
            "import { rendezvous } from './barrier'",
            "await rendezvous()",
            `export default evaluate({ id: '${id}', task: async (input: string) => input, cases: [{ input: 'ok' }] })`,
          ].join("\n"),
        ),
      ),
    );

    const patch = await runtimePatch(root);

    expect(
      patch.facts.definitions
        ?.filter((definition) => definition.kind === "eval")
        .map((definition) => definition.name)
        .sort(),
    ).toEqual(["alpha", "beta"]);
  });

  it("bounds concurrent Eval imports", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    const evals = join(root, "evals");
    await mkdir(evals, { recursive: true });
    await writeFile(
      join(evals, "gate.ts"),
      [
        "let active = 0",
        "export async function enter() {",
        "  active += 1",
        "  if (active > 16) throw new Error('Eval import concurrency was unbounded')",
        "  await new Promise((resolve) => setTimeout(resolve, 25))",
        "  active -= 1",
        "}",
      ].join("\n"),
    );
    await Promise.all(
      Array.from({ length: 17 }, (_, index) => {
        const id = `bounded-${index}`;
        return writeFile(
          join(evals, `${id}.eval.ts`),
          [
            "import { evaluate } from '@use-crux/core/eval'",
            "import { enter } from './gate'",
            "await enter()",
            `export default evaluate({ id: '${id}', task: async (input: string) => input, cases: [{ input: 'ok' }] })`,
          ].join("\n"),
        );
      }),
    );

    const patch = await runtimePatch(root);

    expect(patch.facts.definitions?.filter((definition) => definition.kind === "eval")).toHaveLength(17);
    expect(patch.facts.diagnostics).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "index.module_import_failed" })]),
    );
  });

  it("stops scheduling Eval imports after an import timeout", async () => {
    const root = await mkdtemp(join(workspaceRoot, ".tmp-host-runtime-"));
    roots.push(root);
    const evals = join(root, "evals");
    const waveMarker = join(root, "second-wave-started");
    await mkdir(evals, { recursive: true });
    await Promise.all(
      Array.from({ length: 16 }, (_, index) =>
        writeFile(
          join(evals, `${String(index).padStart(2, "0")}-slow.eval.ts`),
          "await new Promise((resolve) => setTimeout(resolve, 4500))\nexport default {}",
        ),
      ),
    );
    await writeFile(
      join(evals, "99-second-wave.eval.ts"),
      [
        "import { writeFileSync } from 'node:fs'",
        `writeFileSync(${JSON.stringify(waveMarker)}, 'started')`,
        "export default {}",
      ].join("\n"),
    );

    await expect(runtimePatch(root)).rejects.toThrow("Timed out importing");
    await expect(access(waveMarker)).rejects.toMatchObject({ code: "ENOENT" });
  }, 10_000);
});

function runtimePatch(root: string) {
  return indexProjectRuntimeForHost({
    root,
    previousIndex: {
      schemaVersion: 1,
      project: { root },
      indexedAt: new Date(0).toISOString(),
      prompts: [],
      contexts: [],
      definitions: [],
      relations: [],
      diagnostics: [],
      lintFindings: [],
      ruleDescriptors: [],
      sources: [],
    },
  });
}
