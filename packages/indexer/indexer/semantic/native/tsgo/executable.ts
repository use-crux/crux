import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

type NativePreviewPlatformPackageName<
  TPlatform extends string = string,
  TArch extends string = string,
> = `@typescript/native-preview-${TPlatform}-${TArch}`

export interface TsgoExecutableResolutionOptions {
  /** Absolute or project-relative root used as the package resolution base. */
  readonly root: string
  /** Explicit TypeScript-Go executable path from config or environment. */
  readonly explicitPath?: string
  /** Platform override for tests. Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform
  /** Architecture override for tests. Defaults to `process.arch`. */
  readonly arch?: NodeJS.Architecture
}

/**
 * Resolves the TypeScript-Go executable used by the native semantic backend.
 *
 * Crux workers run from content-addressed cache files, so native-preview's own
 * `import.meta.url`-relative platform package lookup cannot see a user's pnpm
 * workspace. Resolving from the indexed project root keeps `native: true`
 * workspace-aware while preserving explicit `tsserverPath` overrides.
 *
 * @throws When the native-preview platform package or its `tsgo` executable is
 * unavailable from the indexed project root.
 */
export function resolveTsgoExecutablePath(options: TsgoExecutableResolutionOptions): string {
  if (options.explicitPath) return options.explicitPath

  const root = resolve(options.root)
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const packageName = nativePreviewPlatformPackageName(platform, arch)
  const packageJsonPath = resolvePlatformPackageJson(root, packageName)
  const executable = join(dirname(packageJsonPath), 'lib', tsgoExecutableName(platform))

  if (!existsSync(executable)) {
    throw new Error(
      [
        `Native semantic indexing was requested, but the TypeScript-Go executable was not found at ${executable}.`,
        'Reinstall @typescript/native-preview in the workspace that owns this project,',
        'or set experimental.indexer.native.tsserverPath / CRUX_INDEX_NATIVE_TSSERVER_PATH.',
      ].join(' '),
    )
  }

  return executable
}

function nativePreviewPlatformPackageName<TPlatform extends string, TArch extends string>(
  platform: TPlatform,
  arch: TArch,
): NativePreviewPlatformPackageName<TPlatform, TArch> {
  return `@typescript/native-preview-${platform}-${arch}`
}

function resolvePlatformPackageJson(root: string, packageName: string): string {
  const requireFromRoot = createRequire(join(root, 'package.json'))
  try {
    return requireFromRoot.resolve(`${packageName}/package.json`)
  } catch (error) {
    throw new Error(
      [
        `Native semantic indexing was requested, but ${packageName} could not be resolved from ${root}.`,
        'Install @typescript/native-preview in the workspace that owns this project,',
        'or set experimental.indexer.native.tsserverPath / CRUX_INDEX_NATIVE_TSSERVER_PATH.',
      ].join(' '),
      { cause: error },
    )
  }
}

function tsgoExecutableName(platform: NodeJS.Platform): 'tsgo' | 'tsgo.exe' {
  return platform === 'win32' ? 'tsgo.exe' : 'tsgo'
}
