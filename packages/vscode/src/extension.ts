import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import * as vscode from 'vscode'
import {
  LanguageClient,
  type LanguageClientOptions,
} from 'vscode-languageclient/node'
import { ClientSlot } from './client-slot.js'
import { createBinaryInvocation, validateBinary } from './binary-runtime.js'
import { discoverBinary, type DiscoveryHost } from './discovery.js'
import { registerExtensionCommands } from './extension-commands.js'
import { offerInstallHelp } from './install-help.js'
import {
  createInitializationOptions,
  serverConfigurationSections,
} from './initialization-options.js'
import { RestartQueue } from './restart-queue.js'
import { createServerOptions } from './server-options.js'
import { activateDecorations } from './vscode-decorations.js'

const execFileAsync = promisify(execFile)
const versionTimeoutMs = 2_000
const stopTimeoutMs = 3_000

let output: vscode.OutputChannel | undefined
let decorations: vscode.Disposable | undefined
const clientSlot = new ClientSlot<LanguageClient>()
const restartQueue = new RestartQueue()

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('Crux')
  decorations = activateDecorations(output)
  context.subscriptions.push(
    output,
    decorations,
    ...registerExtensionCommands({
      registerCommand: (command, handler) => vscode.commands.registerCommand(command, handler),
      getPort: () => vscode.workspace.getConfiguration('crux').get<number>('port', 4400),
      openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      restart: () => queueRestart(),
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('crux.port') || event.affectsConfiguration('crux.binaryPath')) {
        void queueRestart()
      }
    }),
  )
  await startClient()
}

export async function deactivate(): Promise<void> {
  decorations?.dispose()
  decorations = undefined
  const current = clientSlot.take()
  if (current === undefined) return
  await Promise.race([
    current.stop(),
    new Promise<void>((resolve) => setTimeout(resolve, stopTimeoutMs)),
  ])
}

async function queueRestart(): Promise<void> {
  try {
    await restartQueue.enqueue(async () => {
      await clientSlot.stop()
      await startClient()
    })
  } catch (error) {
    await vscode.window.showErrorMessage(
      `Unable to restart Crux language server: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

async function startClient(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const configuration = vscode.workspace.getConfiguration('crux')
  const configuredPath = configuration.get<string>('binaryPath', '')
  let discovered
  try {
    discovered = await discoverBinary(configuredPath, workspaceRoot, nodeDiscoveryHost)
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    return
  }
  if (discovered === undefined) {
    await offerInstallHelp({
      showWarning: (message, ...actions) =>
        vscode.window.showWarningMessage(message, ...actions),
      openExternal: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
      openSettings: () =>
        vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'crux.binaryPath',
        ),
    })
    return
  }

  const invocation = createBinaryInvocation(discovered.path, process.platform)
  let version: string
  try {
    version = await validateBinary(invocation, runBinaryProbe)
  } catch (error) {
    await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error))
    return
  }
  output?.appendLine(`Using Crux ${version} (${discovered.path})`)
  const port = configuration.get<number>('port', 4400)
  const serverOptions = createServerOptions({
    invocation,
    port,
    workspaceRoot,
  })
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescriptreact' },
      { scheme: 'file', language: 'javascriptreact' },
    ],
    initializationOptions: createInitializationOptions({
      port,
      profile: configuration.get<string>('lint.profile', ''),
      includeSuppressed: configuration.get<boolean>('lint.includeSuppressed', false),
      trace: configuration.get<string>('trace', 'off'),
      // The extension host never activates this extension before trust.
      workspaceTrust: true,
    }),
    outputChannel: output,
    synchronize: { configurationSection: [...serverConfigurationSections] },
  }
  const next = new LanguageClient('crux', 'Crux', serverOptions, clientOptions)
  await clientSlot.start(next)
}

async function runBinaryProbe(command: string, args: readonly string[]) {
  return execFileAsync(command, [...args], {
    timeout: versionTimeoutMs,
    windowsHide: true,
  })
}

const nodeDiscoveryHost: DiscoveryHost = {
  platform: process.platform,
  arch: process.arch,
  async isExecutable(path) {
    try {
      await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  async findOnPath(command) {
    try {
      const executable = process.platform === 'win32' ? 'where' : 'which'
      const { stdout } = await execFileAsync(executable, [command], { timeout: versionTimeoutMs })
      return stdout.split(/\r?\n/, 1)[0]?.trim() || undefined
    } catch {
      return undefined
    }
  },
}
