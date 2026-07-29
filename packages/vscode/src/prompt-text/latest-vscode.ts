import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { Utf16Position } from "./contracts.js";
import { openPromptTextLatestRun } from "./latest.js";
import type { PromptTextPreviewSource } from "./preview/types.js";

/** Bind the functional latest-Run operation to VS Code process ports. */
export function createVSCodePromptTextLatestRun(
  client: () => LanguageClient | undefined,
  currentSource: (uri: string) => PromptTextPreviewSource | undefined,
): (source: PromptTextPreviewSource, position: Utf16Position) => Promise<void> {
  return (source, position) =>
    openPromptTextLatestRun(
      {
        client,
        currentSource,
        configuredPort: () =>
          vscode.workspace.getConfiguration("crux").get<number>("port", 4400),
        openExternal: async (url) => {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
        showInformation: (message) => {
          void vscode.window.showInformationMessage(message);
        },
      },
      source,
      position,
    );
}
