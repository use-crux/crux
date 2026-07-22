import { createOpenDevtoolsHandler } from './open-devtools.js'

interface CommandRegistration {
  dispose(): void
}

/** Editor operations needed to register Crux client-side commands. */
export interface ExtensionCommandHost {
  registerCommand(
    command: string,
    handler: (argument?: unknown) => unknown,
  ): CommandRegistration
  getPort(): number
  openExternal(url: string): PromiseLike<unknown>
  restart(): unknown
}

/** Registers the commands contributed by the extension manifest. */
export function registerExtensionCommands(
  host: ExtensionCommandHost,
): readonly CommandRegistration[] {
  return [
    host.registerCommand('crux.openDocs', async (href) => {
      if (typeof href === 'string') await host.openExternal(href)
    }),
    host.registerCommand('crux.openDevtools', createOpenDevtoolsHandler(host)),
    host.registerCommand('crux.restartServer', () => host.restart()),
  ]
}
