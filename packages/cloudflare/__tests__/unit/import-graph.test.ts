import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));

describe("Cloudflare package import graph", () => {
  it("bundles for Workers without Node built-ins or compatibility shims", async () => {
    const builtins = new Set<string>();
    const result = await esbuild.build({
      entryPoints: [resolve(here, "../../src/index.ts")],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      write: false,
      plugins: [
        {
          name: "record-node-builtins",
          setup(build) {
            build.onResolve({ filter: /^node:/ }, (args) => {
              builtins.add(args.path);
              return { path: args.path, external: true };
            });
          },
        },
      ],
    });

    expect([...builtins]).toEqual([]);
    const source = result.outputFiles[0]!.text;
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toContain("Cloudflare Queue");
  });
});
