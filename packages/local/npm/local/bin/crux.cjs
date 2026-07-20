#!/usr/bin/env node

/**
 * npm wrapper for the crux Go binary.
 *
 * Resolves the platform-specific binary from @use-crux/local-{platform}-{arch}
 * and executes it with all arguments passed through.
 *
 * The platform package also ships the Rust Static Index worker in the same
 * bin directory; the Go runtime discovers that sibling binary at startup.
 */

const { spawnSync } = require('child_process')
const childExitStatus = require('./child-exit-status.cjs')
const { platform, arch } = process

// Map Node.js platform/arch to our package naming.
const platformMap = { linux: 'linux', darwin: 'darwin', win32: 'win32' }
const archMap = { x64: 'x64', arm64: 'arm64' }

const os = platformMap[platform]
const cpu = archMap[arch]

if (!os || !cpu) {
  console.error(`Unsupported platform: ${platform}-${arch}`)
  console.error('Crux supports: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win32-x64, win32-arm64')
  process.exit(1)
}

const ext = platform === 'win32' ? '.exe' : ''
const pkg = `@use-crux/local-${os}-${cpu}`

let binPath
try {
  binPath = require.resolve(`${pkg}/bin/crux${ext}`)
} catch {
  const { existsSync } = require('fs')
  const { join } = require('path')
  const devBinary = join(__dirname, '..', '..', '..', 'crux' + ext)
  if (existsSync(devBinary)) {
    binPath = devBinary
  } else {
    console.error(`Could not find binary package: ${pkg}`)
    console.error('Try reinstalling: pnpm install')
    process.exit(1)
  }
}

const args = process.argv.slice(2)

// On Unix, replace this JavaScript launcher with the Go process. This keeps
// terminal ownership, signals, cleanup, and the final exit status on one PID.
if (platform !== 'win32' && typeof process.execve === 'function') {
  process.execve(binPath, [binPath, ...args], process.env)
  throw new Error('process.execve returned unexpectedly')
}

// Node does not expose execve on Windows. Console control events reach both
// processes, so keep the wrapper alive until the inherited-stdio child exits.
const holdSignal = () => {}
process.on('SIGINT', holdSignal)
process.on('SIGTERM', holdSignal)
const result = spawnSync(binPath, args, {
  stdio: 'inherit',
  env: process.env,
})
process.removeListener('SIGINT', holdSignal)
process.removeListener('SIGTERM', holdSignal)

if (result.error) {
  throw result.error
}
process.exit(childExitStatus(result))
