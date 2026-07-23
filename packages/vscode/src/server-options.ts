import type { Executable } from 'vscode-languageclient/node'
import type { BinaryInvocation } from './binary-runtime.js'

/** Values used to construct the language-server process invocation. */
export interface ServerOptionsInput {
  readonly invocation: BinaryInvocation
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
  invocation,
  port,
  workspaceRoot,
}: ServerOptionsInput): Executable {
  return {
    command: invocation.command,
    args: [...invocation.argsPrefix, 'lsp', '--port', String(port)],
    ...(workspaceRoot === undefined ? {} : { options: { cwd: workspaceRoot } }),
  }
}
