import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { postgres } from "../src/runtime";
import type { RuntimeWorkerProjectFixture } from "./runtime-worker-process-harness";

export interface CreateRuntimeWorkerProjectFixtureOptions {
  readonly packageRoot: string;
  readonly url: string;
  readonly fixtureNumber: number;
  readonly delayStartup?: boolean;
  readonly publicWork?: boolean;
}

export async function createRuntimeWorkerProjectFixture({
  packageRoot,
  url,
  fixtureNumber,
  delayStartup = false,
  publicWork = false,
}: CreateRuntimeWorkerProjectFixtureOptions): Promise<RuntimeWorkerProjectFixture> {
  const root = await mkdtemp(join(packageRoot, ".tmp-runtime-worker-process-"));
  const schema = `runtime_worker_process_${process.pid}_${fixtureNumber}`;
  const setup = postgres({ url, schema });
  await setup.setup.apply();
  await setup.close();
  await mkdir(join(root, ".crux/generated/runtime"), { recursive: true });
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "config-entry.ts"),
    configEntry(url, schema, delayStartup),
  );
  await writeFile(
    join(root, "program-entry.ts"),
    programEntry(root, publicWork),
  );
  if (publicWork)
    await writeFile(
      join(root, "application-entry.ts"),
      applicationEntry(url, schema),
    );

  const manifest = runtimeManifest(publicWork);
  const hash = createHash("sha256").update(manifest).digest("hex");
  await Promise.all([
    buildBundle(
      join(root, "config-entry.ts"),
      join(root, "config-bundle.mjs"),
      true,
    ),
    buildBundle(
      join(root, "program-entry.ts"),
      join(root, "program-bundle.mjs"),
    ),
    ...(publicWork
      ? [
          buildBundle(
            join(root, "application-entry.ts"),
            join(root, "application-bundle.mjs"),
            true,
          ),
        ]
      : []),
  ]);
  await writeFile(
    join(root, "crux.config.ts"),
    "export { default } from './config-bundle.mjs'\n",
  );
  await writeFile(
    join(root, ".crux/generated/runtime/manifest.json"),
    manifest,
  );
  await writeFile(
    join(root, ".crux/generated/runtime/program.ts"),
    [
      "export { runtimeProgram } from '../../../program-bundle.mjs'",
      `export const runtimeArtifactManifestHash = '${hash}'`,
      "export const runtimeProgramFormat = 'crux-runtime-program:v1'",
    ].join("\n"),
  );
  return { root, schema, url, executionMarker: join(root, "execution.marker") };
}

function configEntry(
  url: string,
  schema: string,
  delayStartup: boolean,
): string {
  return [
    "import { writeFile } from 'node:fs/promises'",
    ...(delayStartup
      ? [
          "if (process.env.CRUX_RUNTIME_WORKER_STARTUP_MARKER) {",
          "  await writeFile(process.env.CRUX_RUNTIME_WORKER_STARTUP_MARKER, 'loading')",
          "  await new Promise((resolve) => setTimeout(resolve, 30_000))",
          "}",
        ]
      : []),
    "import { config } from '@use-crux/core'",
    "import { node } from '@use-crux/core/runtime'",
    "import { postgres } from '@use-crux/postgres/runtime'",
    `const store = postgres({ url: ${JSON.stringify(url)}, schema: '${schema}' })`,
    "const maintenanceOwnership = store.maintenanceOwnership",
    "if (!maintenanceOwnership) throw new Error('Postgres maintenance ownership is unavailable.')",
    "const markedStore = { ...store, maintenanceOwnership: { async acquire(namespace: string) {",
    "  const ownership = await maintenanceOwnership.acquire(namespace)",
    "  const marker = process.env.CRUX_RUNTIME_WORKER_OWNERSHIP_MARKER",
    "  if (ownership.acquired && marker) await writeFile(marker, 'owned')",
    "  return ownership",
    "} } }",
    "export default config({ runtime: node({ store: markedStore, namespace: 'process-test' }) })",
  ].join("\n");
}

function programEntry(root: string, publicWork: boolean): string {
  if (!publicWork) {
    return [
      "import { createRuntimeProgram, durableTask } from '@use-crux/core/runtime'",
      "const generatedTarget = durableTask('generated-target', { run: async () => 'ok' })",
      "export const runtimeProgram = createRuntimeProgram({ targets: [{ target: generatedTarget, definition: { id: 'task:generated-target', fingerprint: 'definition-generated-target' } }], transports: [] })",
    ].join("\n");
  }
  return [
    "import { access, writeFile } from 'node:fs/promises'",
    "import { flow } from '@use-crux/core'",
    "import { createRuntimeProgram } from '@use-crux/core/runtime'",
    `const executionMarker = ${JSON.stringify(join(root, "execution.marker"))}`,
    "export const generatedTarget = flow('generated-flow', async (_scope, input: { documentId: string }) => {",
    "  const recovering = await access(executionMarker).then(() => true, () => false)",
    "  if (!recovering) {",
    "    await writeFile(executionMarker, 'started')",
    "    await new Promise<void>(() => undefined)",
    "  }",
    "  return { documentId: input.documentId, approved: true as const }",
    "})",
    "export const runtimeProgram = createRuntimeProgram({ targets: [{ target: generatedTarget, definition: { id: 'flow:generated-flow', fingerprint: 'definition-generated-flow' } }], transports: [] })",
  ].join("\n");
}

function applicationEntry(url: string, schema: string): string {
  return [
    "import { createWorkHost, getWork, spawn } from '@use-crux/core'",
    "import { node } from '@use-crux/core/runtime'",
    "import { postgres } from '@use-crux/postgres/runtime'",
    "import { generatedTarget, runtimeProgram } from './program-entry'",
    `const store = postgres({ url: ${JSON.stringify(url)}, schema: '${schema}' })`,
    "const host = createWorkHost({ runtime: node({ store, namespace: 'process-test', autoStartMaintenance: false }), program: runtimeProgram })",
    "const operation = process.argv[2]",
    "const input = JSON.parse(process.argv[3] ?? '{}')",
    "try {",
    "  if (operation === 'spawn') {",
    "    const work = await host.run(() => spawn(generatedTarget, { documentId: input.documentId }, { idempotencyKey: input.idempotencyKey }))",
    "    console.log(JSON.stringify({ id: work.id, status: await work.status() }))",
    "  } else if (operation === 'detach') {",
    "    const work = await host.run(() => getWork(generatedTarget, input.id))",
    "    await work.progress({ message: 'accepted externally', current: 1, total: 2 })",
    "    await work.detach()",
    "    console.log(JSON.stringify({ id: work.id, status: await work.status() }))",
    "  } else if (operation === 'result') {",
    "    const work = await host.run(() => getWork(generatedTarget, input.id))",
    "    console.log(JSON.stringify({ id: work.id, result: await work.result(), status: await work.status(), effects: work.effects, stats: await work.stats() }))",
    "  } else throw new Error(`Unknown operation: ${operation}`)",
    "} catch (error) {",
    "  console.log(JSON.stringify({ error: typeof error === 'object' && error && 'code' in error ? error.code : String(error) }))",
    "} finally {",
    "  host.dispose()",
    "  await store.close()",
    "}",
  ].join("\n");
}

function runtimeManifest(publicWork: boolean): string {
  const target = publicWork
    ? {
        name: "generated-flow",
        kind: "flow",
        module: "./src/flow.ts",
        export: "generatedTarget",
        definitionId: "flow:generated-flow",
        fingerprint: "definition-generated-flow",
      }
    : {
        name: "generated-target",
        kind: "task",
        module: "./src/task.ts",
        export: "generatedTarget",
        definitionId: "task:generated-target",
        fingerprint: "definition-generated-target",
      };
  return `${JSON.stringify({ version: 2, evalPrivacyFingerprint: "test", targets: [target], providers: [], transports: [], evals: [] }, null, 2)}\n`;
}

function buildBundle(
  entryPoint: string,
  outfile: string,
  needsRequire = false,
) {
  return build({
    entryPoints: [entryPoint],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    ...(needsRequire
      ? {
          banner: {
            js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
          },
        }
      : {}),
  });
}
