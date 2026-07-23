import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Returns the immutable byte identity recorded for one staged asset. */
export async function assetRecord(path, name) {
  const bytes = await readFile(path);
  return {
    name,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Writes checksums only after every public asset has reached its final bytes. */
export async function writeChecksums(publicDir, assets) {
  const body = [...assets]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(({ sha256, name }) => `${sha256}  ${name}`)
    .join("\n");
  await writeFile(join(publicDir, "SHA256SUMS"), `${body}\n`);
}

/** Writes stable, human-readable JSON for workflow diagnostics. */
export async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}
