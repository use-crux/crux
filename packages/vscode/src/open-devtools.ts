/** Host operations used by the editor-independent devtools command handler. */
export interface OpenDevtoolsHost {
  getPort(): number
  openExternal(url: string): PromiseLike<unknown>
}

/**
 * Creates the client-side devtools opener used by code lenses and the command
 * palette. Calls without a lens URL open the currently configured local root.
 */
export function createOpenDevtoolsHandler(
  host: OpenDevtoolsHost,
): (argument: unknown) => Promise<void> {
  return async (argument) => {
    const url = typeof argument === 'string' && argument !== ''
      ? argument
      : `http://localhost:${host.getPort()}/`
    await host.openExternal(url)
  }
}
