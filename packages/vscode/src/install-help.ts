export const installGuideUrl =
  'https://cruxjs.dev/docs/reference/lsp#install-the-extension-and-cli'

/** Editor operations used when no runnable Crux CLI can be discovered. */
export interface InstallHelpHost {
  showWarning(
    message: string,
    ...actions: readonly string[]
  ): PromiseLike<string | undefined>
  openExternal(url: string): PromiseLike<unknown>
  openSettings?(): PromiseLike<unknown>
}

/** Offers both supported installation paths and the explicit-path escape hatch. */
export async function offerInstallHelp(host: InstallHelpHost): Promise<void> {
  const action = await host.showWarning(
    'Crux binary not found. Install @use-crux/local or use a native release archive.',
    'View Installation Guide',
    'Open Binary Settings',
  )
  if (action === 'View Installation Guide') {
    await host.openExternal(installGuideUrl)
  } else if (action === 'Open Binary Settings') {
    await host.openSettings?.()
  }
}
