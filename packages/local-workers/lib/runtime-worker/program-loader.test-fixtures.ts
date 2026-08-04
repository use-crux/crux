import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const roots: string[] = [];

export async function fixture(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "crux-runtime-worker-loader-"));
  roots.push(root);
  for (const [file, contents] of Object.entries(files)) {
    const destination = join(root, file);
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, contents);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
