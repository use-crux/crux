package protocol

type CodeActionKind string

const CodeActionQuickFix CodeActionKind = "quickfix"

type CodeActionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Range        Range                  `json:"range"`
	Context      CodeActionContext      `json:"context"`
}

type CodeActionContext struct {
	Diagnostics []Diagnostic     `json:"diagnostics"`
	Only        []CodeActionKind `json:"only,omitempty"`
}

type CodeAction struct {
	Title       string         `json:"title"`
	Kind        CodeActionKind `json:"kind,omitempty"`
	Diagnostics []Diagnostic   `json:"diagnostics,omitempty"`
	Edit        *WorkspaceEdit `json:"edit,omitempty"`
	Command     *Command       `json:"command,omitempty"`
}

// CodeActionClientCapabilities contains the standard literal support gate.
type CodeActionClientCapabilities struct {
	CodeActionLiteralSupport *CodeActionLiteralSupport `json:"codeActionLiteralSupport,omitempty"`
}

// CodeActionLiteralSupport lists the action kinds a client can preserve.
type CodeActionLiteralSupport struct {
	CodeActionKind CodeActionKindLiteralSupport `json:"codeActionKind"`
}

// CodeActionKindLiteralSupport is the standard supported-kind value set.
type CodeActionKindLiteralSupport struct {
	ValueSet []CodeActionKind `json:"valueSet"`
}

type WorkspaceEdit struct {
	Changes         map[DocumentURI][]TextEdit `json:"changes,omitempty"`
	DocumentChanges []TextDocumentEdit         `json:"documentChanges,omitempty"`
}

// TextDocumentEdit is the only WorkspaceEdit document change emitted by
// PromptText quick fixes.
type TextDocumentEdit struct {
	TextDocument VersionedTextDocumentIdentifier `json:"textDocument"`
	Edits        []TextEdit                      `json:"edits"`
}

type TextEdit struct {
	Range   Range  `json:"range"`
	NewText string `json:"newText"`
}

type Command struct {
	Title     string `json:"title"`
	Command   string `json:"command"`
	Arguments []any  `json:"arguments,omitempty"`
}
