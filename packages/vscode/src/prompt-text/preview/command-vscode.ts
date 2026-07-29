import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { registerPromptTextCommands } from "../commands.js";
import { createVSCodePromptTextLatestRun } from "../latest-vscode.js";
import { createVSCodePromptTextExactPreview } from "./exact-vscode.js";
import type { PromptTextPreviewCommandTarget } from "../commands.js";
import type { PromptTextPreviewSource } from "./types.js";

interface PromptTextCommandPorts {
  readonly client: () => LanguageClient | undefined;
  readonly activeTarget: () => PromptTextPreviewCommandTarget | undefined;
  readonly currentSource: (uri: string) => PromptTextPreviewSource | undefined;
  readonly previewStatic: (
    target: PromptTextPreviewCommandTarget,
  ) => Promise<void>;
}

/** Register the three editor-owned PromptText commands against VS Code ports. */
export function registerVSCodePromptTextCommands(
  ports: PromptTextCommandPorts,
): readonly vscode.Disposable[] {
  return registerPromptTextCommands({
    registerCommand: (command, handler) =>
      vscode.commands.registerCommand(command, handler),
    activeTarget: ports.activeTarget,
    preview: (source, position) => ports.previewStatic({ source, position }),
    previewExact: createVSCodePromptTextExactPreview(
      ports.client,
      ports.currentSource,
    ),
    openLatestRun: createVSCodePromptTextLatestRun(
      ports.client,
      ports.currentSource,
    ),
    showInformation: (message) => {
      void vscode.window.showInformationMessage(message);
    },
  });
}
