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
  readonly effectRecovery?: boolean;
}

export async function createRuntimeWorkerProjectFixture({
  packageRoot,
  url,
  fixtureNumber,
  delayStartup = false,
  publicWork = false,
  effectRecovery = false,
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
    programEntry(root, publicWork, effectRecovery),
  );
  if (publicWork || effectRecovery)
    await writeFile(
      join(root, "application-entry.ts"),
      effectRecovery
        ? effectApplicationEntry(root, url, schema)
        : applicationEntry(url, schema),
    );

  const manifest = runtimeManifest(publicWork, effectRecovery);
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
    ...(publicWork || effectRecovery
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
  return {
    root,
    schema,
    url,
    executionMarker: join(root, "execution.marker"),
    recoveryReadyMarker: join(root, "recovery-ready.marker"),
    recoveryCallsMarker: join(root, "recovery-calls.log"),
    recoveryEffectMarker: join(root, "recovery-effect.marker"),
    recoveryScopeMarker: join(root, "recovery-scope.json"),
  };
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

function programEntry(
  root: string,
  publicWork: boolean,
  effectRecovery: boolean,
): string {
  if (effectRecovery) {
    return [
      "import { appendFile, writeFile } from 'node:fs/promises'",
      "import { effect } from '@use-crux/core'",
      "import { createRuntimeProgram } from '@use-crux/core/runtime'",
      `const recoveryCallsMarker = ${JSON.stringify(join(root, "recovery-calls.log"))}`,
      `const recoveryEffectMarker = ${JSON.stringify(join(root, "recovery-effect.marker"))}`,
      "export const generatedEffect = effect('generated-effect', async (input: { documentId: string }) => input, {",
      "  recover: async ({ idempotencyKey }) => {",
      "    await appendFile(recoveryCallsMarker, `${idempotencyKey}\\n`)",
      "    await writeFile(recoveryEffectMarker, idempotencyKey, { flag: 'wx' })",
      "  },",
      "})",
      "export const runtimeProgram = createRuntimeProgram({ targets: [], effectTargets: [generatedEffect], transports: [] })",
    ].join("\n");
  }
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

function effectApplicationEntry(root: string, url: string, schema: string): string {
  return [
    "import { writeFile } from 'node:fs/promises'",
    "import { config, flow, rollback } from '@use-crux/core'",
    "import { node } from '@use-crux/core/runtime'",
    "import { postgres } from '@use-crux/postgres/runtime'",
    "import { generatedEffect, runtimeProgram } from './program-entry'",
    `const baseStore = postgres({ url: ${JSON.stringify(url)}, schema: '${schema}' })`,
    `const recoveryReadyMarker = ${JSON.stringify(join(root, "recovery-ready.marker"))}`,
    `const recoveryScopeMarker = ${JSON.stringify(join(root, "recovery-scope.json"))}`,
    "const operation = process.argv[2]",
    "const input = JSON.parse(process.argv[3] ?? '{}')",
    "let pendingScope: unknown",
    "let rollbackPersisted = false",
    "const interruptEffects = (effects: typeof baseStore.effects) => ({ ...effects, async transitionScope(transition: Parameters<typeof effects.transitionScope>[0]) {",
    "  const stored = await effects.transitionScope(transition)",
    "  if (stored && transition.next.scope.status === 'rolling_back') rollbackPersisted = true",
    "  return stored",
    "} })",
    "const interruptedStore = { ...baseStore, effects: interruptEffects(baseStore.effects), async transact(run: Parameters<typeof baseStore.transact>[0]) {",
    "  const result = await baseStore.transact((tx) => run({ ...tx, effects: interruptEffects(tx.effects!) }))",
    "  if (rollbackPersisted) {",
    "    rollbackPersisted = false",
    "    await writeFile(recoveryScopeMarker, JSON.stringify(pendingScope))",
    "    await writeFile(recoveryReadyMarker, 'ready')",
    "    await new Promise<void>(() => undefined)",
    "  }",
    "  return result",
    "} }",
    "const runtime = config({ runtime: node({ store: operation === 'interrupt' ? interruptedStore : baseStore, namespace: 'process-test', program: runtimeProgram, autoStartMaintenance: false }) })",
    "try {",
    "  if (operation === 'interrupt') {",
    "    const work = flow('generated-effect-flow', async () => generatedEffect({ documentId: input.documentId }))",
    "    const completed = await work.run()",
    "    pendingScope = completed.effects",
    "    await rollback(completed.effects)",
    "  } else if (operation === 'effect-status') {",
    "    const snapshot = await baseStore.effects.reconstructScope(input.scope, { namespace: 'process-test' })",
    "    console.log(JSON.stringify(snapshot))",
    "  } else throw new Error(`Unknown operation: ${operation}`)",
    "} finally {",
    "  runtime.dispose()",
    "  await baseStore.close()",
    "}",
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

function runtimeManifest(publicWork: boolean, effectRecovery: boolean): string {
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
  return `${JSON.stringify({
    version: 3,
    evalPrivacyFingerprint: "test",
    targets: effectRecovery ? [] : [target],
    effectTargets: effectRecovery
      ? [{ id: "generated-effect", version: 1, module: "./src/effect.ts", export: "generatedEffect" }]
      : [],
    providers: [],
    transports: [],
    evals: [],
  }, null, 2)}\n`;
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
