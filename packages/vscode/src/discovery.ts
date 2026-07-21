import { isAbsolute, resolve } from 'node:path'

/** Filesystem and process lookups used to discover a runnable Crux CLI. */
export interface DiscoveryHost {
  readonly platform: NodeJS.Platform
  readonly arch: string
  isExecutable(path: string): Promise<boolean>
  findOnPath(command: string): Promise<string | undefined>
}

/** Describes which discovery tier supplied the selected CLI. */
export type BinarySource = 'configured' | 'workspace' | 'path'

/** An executable Crux CLI and the discovery tier that supplied it. */
export interface DiscoveredBinary {
  readonly path: string
  readonly source: BinarySource
}

/** Resolves the first executable Crux CLI using the extension's binding order. */
export async function discoverBinary(
  configuredPath: string,
  workspaceRoot: string | undefined,
  host: DiscoveryHost,
): Promise<DiscoveredBinary | undefined> {
  const configured = configuredPath.trim()
  if (configured !== '') {
    const path = isAbsolute(configured)
      ? configured
      : resolve(workspaceRoot ?? process.cwd(), configured)
    if (!(await host.isExecutable(path))) {
      throw new Error(`Configured Crux binary is not executable: ${path}`)
    }
    return { path, source: 'configured' }
  }

  if (workspaceRoot !== undefined) {
    for (const path of workspaceCandidates(workspaceRoot, host.platform, host.arch)) {
      if (await host.isExecutable(path)) {
        return { path, source: 'workspace' }
      }
    }
  }

  const pathBinary = await host.findOnPath(host.platform === 'win32' ? 'crux.exe' : 'crux')
  if (pathBinary !== undefined && await host.isExecutable(pathBinary)) {
    return { path: pathBinary, source: 'path' }
  }
  return undefined
}

/** Returns repository-local CLI candidates in binding discovery order. */
export function workspaceCandidates(
  workspaceRoot: string,
  platform: NodeJS.Platform,
  arch: string,
): readonly string[] {
  const executable = platform === 'win32' ? 'crux.exe' : 'crux'
  const platformID = `${platform}-${arch}`
  return [
    resolve(workspaceRoot, 'packages', 'local', 'dist', platformID, executable),
    resolve(workspaceRoot, 'packages', 'local', 'dist', `crux-${platformID}`, 'bin', executable),
    resolve(workspaceRoot, 'packages', 'local', executable),
    resolve(workspaceRoot, executable),
  ]
}
