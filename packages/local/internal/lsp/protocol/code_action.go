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

type WorkspaceEdit struct {
	Changes map[DocumentURI][]TextEdit `json:"changes"`
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
