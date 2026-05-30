#!/usr/bin/env node

/**
 * npm wrapper for the crux Go binary.
 *
 * Resolves the platform-specific binary from @crux/local-{platform}-{arch}
 * and executes it with all arguments passed through.
 */

const { execFileSync } = require("child_process");
const { platform, arch } = process;

// Map Node.js platform/arch to our package naming.
const platformMap = { linux: "linux", darwin: "darwin", win32: "win32" };
const archMap = { x64: "x64", arm64: "arm64" };

const os = platformMap[platform];
const cpu = archMap[arch];

if (!os || !cpu) {
  console.error(`Unsupported platform: ${platform}-${arch}`);
  console.error("Crux supports: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64, win32-arm64");
  process.exit(1);
}

const ext = platform === "win32" ? ".exe" : "";
const pkg = `@crux/local-${os}-${cpu}`;

let binPath;
try {
  binPath = require.resolve(`${pkg}/bin/crux${ext}`);
} catch {
  const { existsSync } = require("fs");
  const { join } = require("path");
  const devBinary = join(__dirname, "..", "..", "..", "crux" + ext);
  if (existsSync(devBinary)) {
    binPath = devBinary;
  } else {
    console.error(`Could not find binary package: ${pkg}`);
    console.error("Try reinstalling: pnpm install");
    process.exit(1);
  }
}

try {
  const result = execFileSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });
} catch (e) {
  // execFileSync throws on non-zero exit code — propagate it.
  if (e.status != null) {
    process.exit(e.status);
  }
  throw e;
}
