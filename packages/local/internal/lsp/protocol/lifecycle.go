package protocol

import "encoding/json"

// DocumentURI is an LSP document URI.
type DocumentURI string

type ClientInfo struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
}

type WorkspaceFolder struct {
	URI  DocumentURI `json:"uri"`
	Name string      `json:"name"`
}

type InitializeParams struct {
	ProcessID             *int              `json:"processId,omitempty"`
	ClientInfo            *ClientInfo       `json:"clientInfo,omitempty"`
	RootURI               DocumentURI       `json:"rootUri,omitempty"`
	InitializationOptions json.RawMessage   `json:"initializationOptions,omitempty"`
	WorkspaceFolders      []WorkspaceFolder `json:"workspaceFolders,omitempty"`
}

type InitializeResult struct {
	Capabilities ServerCapabilities `json:"capabilities"`
	ServerInfo   ServerInfo         `json:"serverInfo"`
}

type ServerInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

type ServerCapabilities struct {
	TextDocumentSync   TextDocumentSyncOptions `json:"textDocumentSync"`
	CodeActionProvider CodeActionOptions       `json:"codeActionProvider"`
	Workspace          WorkspaceOptions        `json:"workspace"`
}

type TextDocumentSyncOptions struct {
	OpenClose bool        `json:"openClose"`
	Change    SyncKind    `json:"change"`
	Save      SaveOptions `json:"save"`
}

type SyncKind int

const SyncNone SyncKind = 0

type SaveOptions struct {
	IncludeText bool `json:"includeText"`
}

type CodeActionOptions struct {
	CodeActionKinds []CodeActionKind `json:"codeActionKinds"`
}

type WorkspaceOptions struct {
	WorkspaceFolders WorkspaceFoldersOptions `json:"workspaceFolders"`
}

type WorkspaceFoldersOptions struct {
	Supported           bool `json:"supported"`
	ChangeNotifications bool `json:"changeNotifications"`
}

type TextDocumentIdentifier struct {
	URI DocumentURI `json:"uri"`
}

type VersionedTextDocumentIdentifier struct {
	TextDocumentIdentifier
	Version int `json:"version"`
}

type TextDocumentItem struct {
	URI        DocumentURI `json:"uri"`
	LanguageID string      `json:"languageId"`
	Version    int         `json:"version"`
	Text       string      `json:"text"`
}

type DidOpenTextDocumentParams struct {
	TextDocument TextDocumentItem `json:"textDocument"`
}

type DidCloseTextDocumentParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

type DidSaveTextDocumentParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Text         *string                `json:"text,omitempty"`
}

type DidChangeTextDocumentParams struct {
	TextDocument   VersionedTextDocumentIdentifier `json:"textDocument"`
	ContentChanges []json.RawMessage               `json:"contentChanges"`
}

type DidChangeConfigurationParams struct {
	Settings json.RawMessage `json:"settings"`
}

type CancelParams struct {
	ID json.RawMessage `json:"id"`
}
