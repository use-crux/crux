import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import type { Utf16Position } from "../contracts.js";
import { openPromptTextExactPreview } from "./exact.js";
import type { PromptTextPreviewSource } from "./types.js";

/** Bind the pure exact-preview operation to the VS Code process ports. */
export function createVSCodePromptTextExactPreview(
  client: () => LanguageClient | undefined,
  currentSource: (uri: string) => PromptTextPreviewSource | undefined,
): (source: PromptTextPreviewSource, position: Utf16Position) => Promise<void> {
  return (source, position) =>
    openPromptTextExactPreview(
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
