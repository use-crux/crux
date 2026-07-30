import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IndexPatchFacts } from "../src/indexer/patches";
import { semanticIndexFacts } from "../src/indexer/semantic";

const fixtureRoots: string[] = [];

/** Removes every PromptText diagnostic fixture created by the current test. */
export async function cleanupPromptTextDiagnosticFixtures(): Promise<void> {
  await Promise.all(
    fixtureRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
}

/**
 * Indexes one real TypeScript workspace with the JavaScript semantic backend.
 *
 * @param source - Complete `src/index.ts` contents.
 * @returns Project Index semantic facts and the absolute fixture source file.
 */
export async function promptTextDiagnosticFacts(
  source: string,
  additionalFiles: Readonly<Record<string, string>> = {},
): Promise<{
  readonly facts: IndexPatchFacts;
  readonly file: string;
  readonly root: string;
}> {
  const root = await mkdtemp(
    join(process.cwd(), ".tmp-prompt-text-diagnostics-"),
  );
  fixtureRoots.push(root);
  const sourceDirectory = join(root, "src");
  const packageScope = join(root, "node_modules/@use-crux");
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(packageScope, { recursive: true });
  await symlink(
    join(process.cwd(), "../core"),
    join(packageScope, "core"),
    "dir",
  );
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
  const file = join(sourceDirectory, "index.ts");
  await writeFile(file, source);
  for (const [relativeFile, contents] of Object.entries(additionalFiles)) {
    const additionalFile = join(root, relativeFile);
    await mkdir(dirname(additionalFile), { recursive: true });
    await writeFile(additionalFile, contents);
  }
  return {
    facts: semanticIndexFacts(root, [file]),
    file,
    root,
  };
}
