/**
 * Next.js integration for Crux Runtime Engine artifacts.
 *
 * `withCruxBuild()` keeps generated runtime entry files fresh inside the Next dev
 * and build graph. It delegates actual discovery and writing to the `crux`
 * CLI, so this subpath stays lightweight and does not make `@use-crux/core`
 * depend on the Project Index compiler.
 *
 * @module
 */

import { spawnSync } from 'node:child_process'
import { createRuntimeError } from './engine/errors'

type NextWebpackConfig = Record<string, unknown>
type NextWebpackContext = Record<string, unknown>
type NextWebpackHook = (
  config: NextWebpackConfig,
  context: NextWebpackContext,
) => NextWebpackConfig

type ConfiguredWebpackHook<TConfig> = 'webpack' extends keyof TConfig
  ? TConfig['webpack']
  : never

type WrappedWebpackHook<TConfig> = [
  NonNullable<ConfiguredWebpackHook<TConfig>>,
] extends [never]
  ? NextWebpackHook
  : NonNullable<ConfiguredWebpackHook<TConfig>> extends (
        ...args: infer TArgs
      ) => infer TResult
    ? (...args: TArgs) => TResult
    : NextWebpackHook

/** Minimal Next config shape accepted by {@link withCruxBuild}. */
export interface CruxNextConfig {
  webpack?: unknown
}

/** Options for {@link withCruxBuild}. */
export interface WithCruxBuildOptions {
  /** Working directory for `crux runtime generate`. Defaults to `process.cwd()`. */
  readonly cwd?: string
  /** Command used to generate artifacts. Defaults to `crux runtime generate`. */
  readonly command?: readonly [string, ...string[]]
  /** Environment passed to the generator command. Defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
}

/**
 * Wrap a Next config so Crux runtime artifacts are regenerated during dev and build.
 *
 * The wrapper runs `crux runtime generate` while Next evaluates the config,
 * which covers both Webpack and Turbopack builds. It then delegates to the
 * user's existing `webpack` function if present. A failed generator command
 * throws `ARTIFACTS_STALE`, which fails CI/builds before stale runtime entry
 * files can deploy.
 */
export function withCruxBuild<TConfig extends object>(
  nextConfig: TConfig = {} as TConfig,
  options: WithCruxBuildOptions = {},
): Omit<TConfig, 'webpack'> & { webpack: WrappedWebpackHook<TConfig> } {
  const command = options.command ?? ['crux', 'runtime', 'generate']
  runCruxRuntimeGenerate({
    command,
    cwd: options.cwd,
    env: options.env,
  })
  const userWebpack = (nextConfig as CruxNextConfig).webpack as
    | NextWebpackHook
    | null
    | undefined
  return {
    ...nextConfig,
    webpack(
      config: NextWebpackConfig,
      context: NextWebpackContext,
    ): NextWebpackConfig {
      return typeof userWebpack === 'function'
        ? userWebpack(config, context)
        : config
    },
  } as Omit<TConfig, 'webpack'> & { webpack: WrappedWebpackHook<TConfig> }
}

function runCruxRuntimeGenerate(
  input: Required<Pick<WithCruxBuildOptions, 'command'>> & WithCruxBuildOptions,
): void {
  const [command, ...args] = input.command
  const result = spawnSync(command, args, {
    cwd: input.cwd ?? process.cwd(),
    env: input.env ?? process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status === 0) return
  throw createRuntimeError({
    code: 'ARTIFACTS_STALE',
    whatFailed:
      'Crux runtime artifacts could not be generated during the Next build.',
    why:
      result.error?.message ??
      `\`${[command, ...args].join(' ')}\` exited with status ${result.status ?? 'unknown'}.`,
    whatStillWorks:
      'Hand-written runtime entries using createRuntimeHandler({ targets }) still work.',
    nextStep:
      'Run `crux runtime generate` locally, fix the reported issue, and rerun the Next build.',
    cause: result.error,
  })
}
