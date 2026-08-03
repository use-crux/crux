import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

interface ProjectConfigArtifact {
  readonly type: "artifact:done";
  readonly artifact: "projectConfig";
  readonly payload: {
    readonly configFile: {
      readonly status: string;
    };
    readonly experimental: {
      readonly indexer: {
        readonly native: {
          readonly value: string;
        };
      };
    };
  };
}

interface RuntimeArtifactsArtifact {
  readonly type: "artifact:done";
  readonly artifact: "runtimeArtifacts";
  readonly payload: {
    readonly manifest: {
      readonly evals: readonly {
        readonly id: string;
        readonly cases: readonly { readonly id: string }[];
      }[];
    };
  };
}

interface StaticIndexConfigArtifact {
  readonly type: "artifact:done";
  readonly artifact: "projectStaticIndexConfig";
  readonly payload: {
    readonly configDependencies: readonly string[];
    readonly cacheDisabled?: boolean;
    readonly diagnostics: readonly unknown[];
  };
}

const PACKAGE_ROOT = resolve(__dirname, "..");
const BUILT_WORKER = resolve(PACKAGE_ROOT, "dist/project-indexer.mjs");
const CORE_PACKAGE = resolve(PACKAGE_ROOT, "../core");
const WORKER_RESPONSE_TIMEOUT_MS = 45_000;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("built project-indexer TypeScript imports", () => {
  it("loads a project config without a project-local tsx installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-built-config-import-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["*"] } },
      }),
    );
    await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
    await symlink(
      CORE_PACKAGE,
      join(root, "node_modules/@use-crux/core"),
      "dir",
    );
    await mkdir(join(root, "node_modules/react"), { recursive: true });
    await writeFile(
      join(root, "node_modules/react/package.json"),
      JSON.stringify({
        type: "module",
        exports: { "./jsx-runtime": "./jsx-runtime.js" },
      }),
    );
    await writeFile(
      join(root, "node_modules/react/jsx-runtime.js"),
      "export const jsx = (type, props) => ({ type, props })\n",
    );
    await writeFile(
      join(root, "value.ts"),
      [
        "export enum NativeMode { Disabled, Enabled }",
        "export namespace Defaults {",
        "  export const mode = NativeMode.Enabled",
        "}",
      ].join("\n"),
    );
    await writeFile(
      join(root, "settings.tsx"),
      [
        'import { Defaults, NativeMode } from "@/value"',
        "class Setting {",
        "  constructor(public readonly enabled: boolean) {}",
        "}",
        'const marker = <span data-crux="loaded" />',
        "void marker",
        "export const native = new Setting(",
        "  Defaults.mode === NativeMode.Enabled,",
        ").enabled",
      ].join("\n"),
    );
    await writeFile(
      join(root, "crux.config.ts"),
      [
        'import { config } from "@use-crux/core"',
        'import { native } from "./settings"',
        "export default config({",
        "  experimental: { indexer: { native } },",
        "})",
      ].join("\n"),
    );

    const event = await runBuiltWorker({
      method: "inspectProjectConfig",
      protocolVersion: 3,
      root,
      resolutionMode: "config-policy",
    });

    expect(event.payload.configFile.status).toBe("loaded");
    expect(event.payload.experimental.indexer.native.value).toBe("true");
  }, 60_000);

  it("reports extended alias config dependencies through the built worker", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "crux-built-config-dependencies-"),
    );
    roots.push(root);
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await mkdir(join(root, "config"), { recursive: true });
    await writeFile(
      join(root, "config/base.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: "..", paths: { "@/*": ["src/*"] } },
      }),
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./config/base.json" }),
    );
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src/value.ts"), "export const value = true\n");
    await writeFile(
      join(root, "crux.config.ts"),
      [
        'import { value } from "@/value"',
        "export default { config: { experimental: { indexer: { native: value } } }, prompts: [], contexts: [], get() {} }",
      ].join("\n"),
    );

    const event = await runBuiltWorker<StaticIndexConfigArtifact>(
      { method: "inspectProjectStaticIndexConfig", protocolVersion: 3, root },
      "projectStaticIndexConfig",
    );

    expect(event.payload.diagnostics).toEqual([]);
    expect(event.payload.configDependencies).toEqual([
      "config/base.json",
      "tsconfig.json",
    ]);
    expect(event.payload.cacheDisabled).not.toBe(true);
  }, 60_000);

  it("rejects an authored alias outside the project boundary before package fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-built-config-contained-"));
    const outside = join(dirname(root), `${basename(root)}-outside.ts`);
    roots.push(root, outside);
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    await writeFile(outside, "export const value = true\n");
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { danger: [`../${basename(outside)}`] },
        },
      }),
    );
    await mkdir(join(root, "node_modules/danger"), { recursive: true });
    await writeFile(
      join(root, "node_modules/danger/package.json"),
      '{"name":"danger","type":"module","exports":"./index.js"}\n',
    );
    await writeFile(
      join(root, "node_modules/danger/index.js"),
      "export const value = false\n",
    );
    await writeFile(
      join(root, "crux.config.ts"),
      [
        'import { value } from "danger"',
        "export default { config: { experimental: { indexer: { native: value } } }, prompts: [], contexts: [], get() {} }",
      ].join("\n"),
    );

    const event = await runBuiltWorker<StaticIndexConfigArtifact>(
      { method: "inspectProjectStaticIndexConfig", protocolVersion: 3, root },
      "projectStaticIndexConfig",
    );

    expect(event.payload.diagnostics).toEqual([
      expect.objectContaining({ code: "index.config_import_failed" }),
    ]);
  }, 60_000);

  it("shares Core identity between a public Eval and the internal collector", async () => {
    const root = await fixtureProject();
    const source = join(root, "evals/support.eval.ts");
    await mkdir(join(root, "evals"), { recursive: true });
    await writeFile(
      source,
      [
        'import { evaluate } from "@use-crux/core/eval"',
        'import { attachEvalTaskDescriptorForInternalUse } from "@use-crux/core/eval/internal/task"',
        "const task = attachEvalTaskDescriptorForInternalUse(async (input: unknown) => input, {",
        '  _tag: "CruxEvalTaskDescriptor", identityEpoch: 2, operation: "generate", adapterId: "ai-sdk",',
        '  capabilities: [], requiredHostCapabilities: ["record-store"], overrideKeys: [], defaults: {},',
        "  projectIdentity: () => ({ reusable: true, fingerprintMaterial: {} }),",
        "  execute: async (input: unknown) => ({ output: input }),",
        "  projectOutput: (result: { output: unknown }) => result.output,",
        "  projectResponse: (result: { output: unknown }) => ({ output: result.output }),",
        "})",
        "export default evaluate({",
        '  id: "support", task,',
        '  cases: [{ id: "refund", input: { question: "refund?" } }],',
        "})",
      ].join("\n"),
    );

    const event = await runBuiltWorker<RuntimeArtifactsArtifact>(
      {
        method: "generateRuntimeArtifacts",
        protocolVersion: 3,
        root,
        definitions: [
          {
            id: "eval:support",
            kind: "eval",
            name: "support",
            fidelity: "resolved",
            source: { file: source, line: 1 },
            metadata: {
              exportName: "default",
              evalContract: "crux.eval",
              runtimeDiscovered: true,
              requiredHostCapabilities: ["record-store"],
              evalExecutionArms: [
                {
                  name: "current",
                  execution: "runtime",
                  requiredHostCapabilities: ["record-store"],
                },
              ],
            },
          },
        ],
      },
      "runtimeArtifacts",
    );

    expect(event.payload.manifest.evals).toEqual([
      expect.objectContaining({
        id: "support",
        cases: [expect.objectContaining({ id: "refund" })],
      }),
    ]);
  }, 60_000);

  it("reloads an unchanged config when only transitive JSON changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "crux-built-config-reload-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), '{"type":"module"}\n');
    const setting = join(root, "setting.json");
    await writeFile(setting, '{"native":true}\n');
    await writeFile(
      join(root, "crux.config.ts"),
      [
        'import setting from "./setting.json" with { type: "json" }',
        "export default {",
        "  config: { experimental: { indexer: { native: setting.native } } },",
        "  prompts: [], contexts: [], get() {},",
        "}",
      ].join("\n"),
    );
    const worker = createBuiltWorkerClient();
    const request = {
      method: "inspectProjectConfig",
      protocolVersion: 3,
      root,
      resolutionMode: "config-policy",
    };
    try {
      const first = await worker.request<ProjectConfigArtifact>(
        request,
        "projectConfig",
      );
      expect(first.payload.experimental.indexer.native.value).toBe("true");

      await writeFile(setting, '{"native":false}\n');
      const second = await worker.request<ProjectConfigArtifact>(
        request,
        "projectConfig",
      );
      expect(second.payload.experimental.indexer.native.value).toBe("false");
    } finally {
      await worker.close();
    }
  }, 30_000);
});

async function fixtureProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "crux-built-eval-import-"));
  roots.push(root);
  await writeFile(join(root, "package.json"), '{"type":"module"}\n');
  await mkdir(join(root, "node_modules/@use-crux"), { recursive: true });
  await symlink(CORE_PACKAGE, join(root, "node_modules/@use-crux/core"), "dir");
  return root;
}

function runBuiltWorker<
  TArtifact extends {
    readonly type: "artifact:done";
    readonly artifact: string;
    readonly payload: unknown;
  } = ProjectConfigArtifact,
>(
  request: unknown,
  artifact: TArtifact["artifact"] = "projectConfig" as TArtifact["artifact"],
): Promise<TArtifact> {
  return new Promise((resolveEvent, rejectEvent) => {
    const child = spawn(process.execPath, [BUILT_WORKER], {
      cwd: PACKAGE_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectEvent(
        new Error("project-indexer did not finish within 45 seconds"),
      );
    }, WORKER_RESPONSE_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectEvent(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectEvent(
          new Error(`project-indexer exited with ${code}: ${stderr.trim()}`),
        );
        return;
      }
      const event = stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Partial<TArtifact>)
        .find(
          (candidate) =>
            candidate.type === "artifact:done" &&
            candidate.artifact === artifact,
        );
      if (!event?.payload) {
        rejectEvent(
          new Error(`${String(artifact)} artifact was not emitted: ${stderr}`),
        );
        return;
      }
      resolveEvent(event as TArtifact);
    });

    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

function createBuiltWorkerClient() {
  const child = spawn(process.execPath, [BUILT_WORKER], {
    cwd: PACKAGE_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let waiting:
    | {
        readonly artifact: string;
        readonly resolve: (value: unknown) => void;
        readonly reject: (error: Error) => void;
        readonly timeout: ReturnType<typeof setTimeout>;
      }
    | undefined;

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    while (stdout.includes("\n")) {
      const newline = stdout.indexOf("\n");
      const line = stdout.slice(0, newline);
      stdout = stdout.slice(newline + 1);
      if (!line || !waiting) continue;
      const event = JSON.parse(line) as {
        readonly type?: string;
        readonly artifact?: string;
      };
      if (event.type !== "artifact:done" || event.artifact !== waiting.artifact)
        continue;
      clearTimeout(waiting.timeout);
      const resolve = waiting.resolve;
      waiting = undefined;
      resolve(event);
    }
  });

  return {
    request<T>(request: unknown, artifact: string): Promise<T> {
      if (waiting) throw new Error("built worker request already pending");
      return new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiting = undefined;
          reject(
            new Error(`project-indexer did not emit ${artifact}: ${stderr}`),
          );
        }, WORKER_RESPONSE_TIMEOUT_MS);
        waiting = {
          artifact,
          resolve: (value) => resolve(value as T),
          reject,
          timeout,
        };
        child.stdin.write(`${JSON.stringify(request)}\n`);
      });
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", () => resolve());
        child.stdin.end();
      });
    },
  };
}
