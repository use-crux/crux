import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const CHECKSUMS_NAME = "SHA256SUMS";

/**
 * Reads and verifies the complete public release directory.
 *
 * The checksum file covers every payload asset but cannot cover itself. Its
 * own identity is computed after the covered set is verified.
 */
export async function readPublicReleaseAssets(publicDir) {
  const checksumPath = join(publicDir, CHECKSUMS_NAME);
  const checksumBytes = await readFile(checksumPath);
  const rows = checksumBytes
    .toString("utf8")
    .trim()
    .split("\n")
    .map(parseChecksumRow);
  const names = rows.map(({ name }) => name);
  if (new Set(names).size !== names.length) {
    throw new Error("SHA256SUMS contains duplicate asset identities.");
  }

  for (const asset of rows) {
    const actual = sha256(await readFile(join(publicDir, asset.name)));
    if (actual !== asset.sha256) {
      throw new Error(`Checksum mismatch for ${asset.name}`);
    }
  }

  const expectedNames = [...names, CHECKSUMS_NAME].sort();
  const actualNames = (await readdir(publicDir)).sort();
  if (!sameStrings(actualNames, expectedNames)) {
    throw new Error(
      "Public release directory does not match its checksum identities.",
    );
  }

  return [
    ...rows,
    { name: CHECKSUMS_NAME, sha256: sha256(checksumBytes) },
  ].sort((left, right) => {
    if (left.name < right.name) return -1;
    if (left.name > right.name) return 1;
    return 0;
  });
}

function parseChecksumRow(line) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`Malformed SHA256SUMS entry: ${line}`);
  return { name: match[2], sha256: match[1] };
}

function sameStrings(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
