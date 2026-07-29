import * as vscode from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { PromptTextDocumentRevisions } from "../document-revisions.js";
import { isPromptTextSourceDocument } from "../documents.js";
import { registerVSCodePromptTextCommands } from "./command-vscode.js";
import { PromptTextPreviewController } from "./controller.js";
import { PromptTextPreviewLanguageTransitions } from "./language-transition.js";
import { promptTextPreviewMetadataCommand } from "./metadata.js";
import {
  PromptTextPreviewDocumentProvider,
  type PromptTextPreviewDocument,
} from "./provider.js";
import type {
  PromptTextPreviewControllerPorts,
  PromptTextPreviewSource,
  PromptTextPreviewStaticParams,
} from "./types.js";
import { PromptTextPreviewDocumentUpdates } from "./updates.js";
import {
  activePreviewTarget,
  chooseTemplate,
  createPreviewUri,
  findDocument,
  previewDocument,
  previewCodeLenses,
  promptTextPreviewScheme,
  sourceSnapshot,
} from "./vscode-source.js";
import { parsePromptTextPreviewStaticResult } from "./wire.js";

const previewMethod = "crux/promptText/previewStatic";

/** Static-preview lifetime that survives language-client replacement. */
export interface PromptTextPreviews extends vscode.Disposable {
  /** Attach a started client, reset connection-local epochs, and repull. */
  connect(client: LanguageClient): void;
  /** Cancel work and clear bytes before retiring the current client. */
  disconnect(): void;
  /** Repull all retained targets whose sources remain open. */
  refresh(): void;
}

/** Register the client-owned virtual-document surface for this extension host. */
export function activatePromptTextPreviews(): PromptTextPreviews {
  return new VSCodePromptTextPreviews();
}

class VSCodePromptTextPreviews implements PromptTextPreviews {
  #revisions = new PromptTextDocumentRevisions();
  readonly #contentChanges = new vscode.EventEmitter<vscode.Uri>();
  readonly #codeLensChanges = new vscode.EventEmitter<void>();
  readonly #updates = new PromptTextPreviewDocumentUpdates();
  readonly #provider: PromptTextPreviewDocumentProvider;
  readonly #controller: PromptTextPreviewController;
  readonly #subscriptions: readonly vscode.Disposable[];
  #client: LanguageClient | undefined;
  readonly #languageTransitions = new PromptTextPreviewLanguageTransitions();
  #disposed = false;

  constructor() {
    this.#provider = new PromptTextPreviewDocumentProvider({
      createUri: (identity) => createPreviewUri(identity).toString(),
      openDocument: async (uri) =>
        previewDocument(
          await vscode.workspace.openTextDocument(vscode.Uri.parse(uri)),
        ),
      setMarkdownLanguage: (document) => this.#setMarkdownLanguage(document),
      refreshDocument: (document) => this.#refreshDocument(document),
      showDocument: async (document) => {
        const source = findDocument(document.uri);
        if (source === undefined) throw new Error("preview document closed");
        await vscode.window.showTextDocument(source, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
          preview: false,
        });
      },
      contentChanged: (uri) => this.#contentChanges.fire(vscode.Uri.parse(uri)),
      codeLensesChanged: () => this.#codeLensChanges.fire(),
    });
    const ports: PromptTextPreviewControllerPorts = {
      currentSource: (uri) => this.#source(uri),
      request: (params, signal) => this.#request(params, signal),
      choose: (choices) => chooseTemplate(choices),
      publish: (slot, ready, reveal) =>
        this.#provider.publish(slot, ready, reveal),
      clear: (slot, reason) => this.#provider.clear(slot, reason),
      refreshing: (slot) => this.#provider.refreshing(slot),
      showInformation: (message) => {
        void vscode.window.showInformationMessage(message);
      },
    };
    this.#controller = new PromptTextPreviewController(ports);
    this.#resetRevisions();
    this.#subscriptions = [
      vscode.workspace.registerTextDocumentContentProvider(
        promptTextPreviewScheme,
        {
          onDidChange: this.#contentChanges.event,
          provideTextDocumentContent: (uri) =>
            this.#provider.provideTextDocumentContent(uri.toString()) ?? "",
        },
      ),
      vscode.languages.registerCodeLensProvider(
        { scheme: promptTextPreviewScheme },
        {
          onDidChangeCodeLenses: this.#codeLensChanges.event,
          provideCodeLenses: (document) =>
            previewCodeLenses(this.#provider, document),
        },
      ),
      vscode.commands.registerCommand(
        promptTextPreviewMetadataCommand,
        () => {},
      ),
      ...registerVSCodePromptTextCommands({
        client: () => this.#client,
        activeTarget: () => this.#activeTarget(),
        currentSource: (uri) => this.#source(uri),
        previewStatic: ({ source, position }) =>
          this.#controller.preview(source, position),
      }),
      vscode.workspace.onDidOpenTextDocument((document) =>
        this.#opened(document),
      ),
      vscode.workspace.onDidChangeTextDocument((event) => this.#changed(event)),
      vscode.workspace.onDidCloseTextDocument((document) =>
        this.#closed(document),
      ),
      vscode.workspace.onDidRenameFiles((event) => {
        for (const file of event.files) {
          this.#controller.sourceRenamed(file.oldUri.toString());
        }
      }),
    ];
  }

  connect(client: LanguageClient): void {
    if (this.#disposed) return;
    this.#client = client;
    this.#resetRevisions();
    void this.#controller.refresh();
  }

  disconnect(): void {
    this.#client = undefined;
    this.#controller.disconnected();
  }

  refresh(): void {
    void this.#controller.refresh();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#client = undefined;
    this.#controller.dispose();
    this.#provider.dispose();
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#contentChanges.dispose();
    this.#codeLensChanges.dispose();
    this.#updates.clear();
    this.#languageTransitions.clear();
  }

  #activeTarget() {
    return activePreviewTarget(this.#revisions);
  }

  #resetRevisions(): void {
    this.#revisions = new PromptTextDocumentRevisions();
    for (const document of vscode.workspace.textDocuments) {
      if (isPromptTextSourceDocument(document)) {
        this.#revisions.open(document.uri.toString());
      }
    }
  }

  #source(uri: string): PromptTextPreviewSource | undefined {
    const document = findDocument(uri);
    return document === undefined || !isPromptTextSourceDocument(document)
      ? undefined
      : sourceSnapshot(this.#revisions, document);
  }

  async #request(params: PromptTextPreviewStaticParams, signal: AbortSignal) {
    const client = this.#client;
    if (client === undefined || signal.aborted) return undefined;
    const cancellation = new vscode.CancellationTokenSource();
    const cancel = () => cancellation.cancel();
    signal.addEventListener("abort", cancel, { once: true });
    try {
      const value = await client.sendRequest<unknown>(
        previewMethod,
        params,
        cancellation.token,
      );
      return parsePromptTextPreviewStaticResult(value);
    } finally {
      signal.removeEventListener("abort", cancel);
      cancellation.dispose();
    }
  }

  #opened(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    if (document.uri.scheme === promptTextPreviewScheme) {
      this.#languageTransitions.opened(uri);
      return;
    }
    if (!isPromptTextSourceDocument(document)) return;
    this.#revisions.open(uri);
    const source = sourceSnapshot(this.#revisions, document);
    if (source !== undefined) void this.#controller.sourceOpened(source);
  }

  #changed(event: vscode.TextDocumentChangeEvent): void {
    const uri = event.document.uri.toString();
    if (event.document.uri.scheme === promptTextPreviewScheme) {
      this.#updates.changed(previewDocument(event.document));
      return;
    }
    if (!isPromptTextSourceDocument(event.document)) return;
    const source = sourceSnapshot(this.#revisions, event.document);
    if (source === undefined) return;
    const delta = event.contentChanges.reduce(
      (sum, change) => sum + change.text.length - change.rangeLength,
      0,
    );
    this.#controller.sourceChanged(
      source,
      source.documentLength - delta,
      event.contentChanges.map((change) => ({
        rangeOffset: change.rangeOffset,
        rangeLength: change.rangeLength,
        text: change.text,
      })),
    );
  }

  #closed(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    if (document.uri.scheme === promptTextPreviewScheme) {
      if (this.#languageTransitions.closed(uri) === "ignore") return;
      const slotId = this.#provider.slotId(uri);
      this.#provider.disposeSlot(uri);
      if (slotId !== undefined) this.#controller.resourceClosed(slotId);
      return;
    }
    if (!isPromptTextSourceDocument(document)) return;
    this.#revisions.close(uri);
    this.#controller.sourceClosed(uri);
  }

  async #setMarkdownLanguage(
    document: PromptTextPreviewDocument,
  ): Promise<PromptTextPreviewDocument> {
    const source = findDocument(document.uri);
    if (source === undefined) throw new Error("preview document closed");
    this.#languageTransitions.begin(document.uri);
    try {
      const changed = await vscode.languages.setTextDocumentLanguage(
        source,
        "markdown",
      );
      if (
        !this.#languageTransitions.complete(
          document.uri,
          changed.uri.toString(),
          changed.languageId,
        )
      ) {
        throw new Error("unexpected preview language transition");
      }
      return previewDocument(changed);
    } finally {
      this.#languageTransitions.finish(document.uri);
    }
  }

  async #refreshDocument(
    document: PromptTextPreviewDocument,
  ): Promise<PromptTextPreviewDocument> {
    return this.#updates.refresh(document, () => {
      this.#contentChanges.fire(vscode.Uri.parse(document.uri));
    });
  }
}
