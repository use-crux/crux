import type { Executable } from 'vscode-languageclient/node'

/** Values used to construct the language-server process invocation. */
export interface ServerOptionsInput {
  readonly binaryPath: string
  readonly port: number
  readonly workspaceRoot: string | undefined
}

/**
 * Creates the Crux executable contract for vscode-languageclient.
 *
 * The transport field is intentionally omitted: command executables default
 * to stdio, while an explicit stdio transport appends an unsupported
 * `--stdio` argument to the Crux CLI invocation.
 */
export function createServerOptions({
  binaryPath,
  port,
  workspaceRoot,
}: ServerOptionsInput): Executable {
  return {
    command: binaryPath,
    args: ['lsp', '--port', String(port)],
    ...(workspaceRoot === undefined ? {} : { options: { cwd: workspaceRoot } }),
  }
}
