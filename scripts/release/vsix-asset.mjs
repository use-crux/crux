import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { releaseAssetNames } from "./asset-names.mjs";
import { assetRecord, writeJson } from "./asset-records.mjs";

const REPRODUCIBLE_ZIP_EPOCH = `${Date.UTC(1980, 0, 1) / 1000}`;

/** Packages a lockstep-versioned VSIX without mutating its source manifest. */
export async function stageExtensionVsix({
  version,
  extensionDir,
  publicDir,
  workspace,
  vscePath,
}) {
  const temporaryExtension = join(workspace, "extension");
  await mkdir(join(temporaryExtension, "dist"), { recursive: true });
  for (const relativePath of ["README.md", "LICENSE", "dist/extension.js"]) {
    const source = join(extensionDir, relativePath);
    if (!existsSync(source))
      throw new Error(`Extension release input is missing ${relativePath}`);
    await cp(source, join(temporaryExtension, relativePath));
  }

  const manifest = JSON.parse(
    await readFile(join(extensionDir, "package.json"), "utf8"),
  );
  manifest.version = version;
  delete manifest.private;
  await writeJson(join(temporaryExtension, "package.json"), manifest);

  const name = releaseAssetNames(version).extension;
  const path = join(publicDir, name);
  run(vscePath, ["package", "--no-dependencies", "--out", path], {
    cwd: temporaryExtension,
    env: { ...process.env, SOURCE_DATE_EPOCH: REPRODUCIBLE_ZIP_EPOCH },
  });
  return {
    ...(await assetRecord(path, name)),
    kind: "extension",
    format: "vsix",
    containedPaths: [
      "extension/package.json",
      "extension/dist/extension.js",
      "extension/readme.md",
      "extension/LICENSE.txt",
    ],
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed (${result.status ?? "signal"}): ${result.stderr || result.stdout}`,
    );
  }
}
