import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface TsgoProjectConfigInput {
  /** TypeScript config files discovered from project shards. */
  readonly tsconfigFiles: readonly string[]
  /** Files selected for semantic analyzer candidate discovery. */
  readonly files: readonly string[]
  /** Dependency closure used by semantic analyzers. */
  readonly dependencyClosure: readonly string[]
}

export interface TsgoProjectConfig {
  /** TypeScript config files to open with the native-preview API. */
  readonly tsconfigFiles: readonly string[]
  /** Cleans up backend-owned temporary config files. */
  close(): void
}

/**
 * Creates the TypeScript-Go project config set for semantic analysis.
 *
 * Crux writes a temporary analysis-only config that mirrors the JavaScript
 * TypeScript backend's semantic compiler profile. That keeps tsgo behavior
 * aligned with the baseline backend, which analyzes the selected semantic file
 * closure instead of opening user tsconfig projects directly.
 */
export function createTsgoProjectConfig(input: TsgoProjectConfigInput): TsgoProjectConfig {
  return createSyntheticTsgoProjectConfig([...new Set([...input.dependencyClosure, ...input.files])])
}

function createSyntheticTsgoProjectConfig(files: readonly string[]): TsgoProjectConfig {
  const directory = mkdtempSync(join(tmpdir(), 'crux-tsgo-project-'))
  const configFile = join(directory, 'tsconfig.json')
  writeFileSync(configFile, JSON.stringify(syntheticTsconfig(files), null, 2), 'utf8')
  return {
    tsconfigFiles: [configFile],
    close() {
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

function syntheticTsconfig(files: readonly string[]): {
  readonly compilerOptions: {
    readonly allowJs: false
    readonly noEmit: true
    readonly skipLibCheck: true
    readonly module: 'ESNext'
    readonly moduleResolution: 'Bundler'
    readonly target: 'ES2022'
    readonly strict: false
    readonly types: readonly []
  }
  readonly files: readonly string[]
} {
  return {
    compilerOptions: {
      allowJs: false,
      noEmit: true,
      skipLibCheck: true,
      module: 'ESNext',
      moduleResolution: 'Bundler',
      target: 'ES2022',
      strict: false,
      types: [],
    },
    files,
  }
}
