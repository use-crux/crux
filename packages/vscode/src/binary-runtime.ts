/** A directly spawnable command plus arguments required before Crux CLI arguments. */
export interface BinaryInvocation {
  readonly command: string
  readonly argsPrefix: readonly string[]
}

/** Output returned by a bounded executable probe. */
export interface BinaryProbeOutput {
  readonly stdout: string
  readonly stderr: string
}

/** Runs one command without a shell unless the invocation explicitly names one. */
export type BinaryProbe = (
  command: string,
  args: readonly string[],
) => Promise<BinaryProbeOutput>

/**
 * Creates a spawn contract for a native binary or npm-generated Windows shim.
 *
 * Windows cannot execute `.cmd` files directly. Passing the shim as a discrete
 * command-processor argument avoids enabling a general-purpose shell option on
 * every server launch.
 */
export function createBinaryInvocation(
  path: string,
  platform: NodeJS.Platform,
  commandProcessor = process.env.ComSpec ?? 'cmd.exe',
): BinaryInvocation {
  if (platform === 'win32' && path.toLowerCase().endsWith('.cmd')) {
    return {
      command: commandProcessor,
      argsPrefix: ['/d', '/s', '/c', 'call', path],
    }
  }
  return { command: path, argsPrefix: [] }
}

/** Probes a selected CLI and rejects unusable binaries before LSP startup. */
export async function validateBinary(
  invocation: BinaryInvocation,
  run: BinaryProbe,
): Promise<string> {
  const displayPath = invocation.argsPrefix.at(-1) ?? invocation.command
  try {
    const { stdout, stderr } = await run(invocation.command, [
      ...invocation.argsPrefix,
      '--version',
    ])
    const version = `${stdout}${stderr}`.trim()
    if (version === '') throw new Error('empty version output')
    return version
  } catch (error) {
    throw new Error(
      `Unable to run Crux binary ${displayPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
