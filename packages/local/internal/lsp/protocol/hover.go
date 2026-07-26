package protocol

// MarkupKind identifies the representation of LSP human-readable content.
type MarkupKind string

const (
	MarkupKindPlainText MarkupKind = "plaintext"
	MarkupKindMarkdown  MarkupKind = "markdown"
)

// ClientCapabilities contains the initialize-time capabilities used by Crux.
type ClientCapabilities struct {
	TextDocument *TextDocumentClientCapabilities `json:"textDocument,omitempty"`
	Workspace    *WorkspaceClientCapabilities    `json:"workspace,omitempty"`
	Experimental *ExperimentalClientCapabilities `json:"experimental,omitempty"`
}

// WorkspaceClientCapabilities contains workspace-wide refresh support.
type WorkspaceClientCapabilities struct {
	InlayHint *RefreshSupportClientCapabilities `json:"inlayHint,omitempty"`
	CodeLens  *RefreshSupportClientCapabilities `json:"codeLens,omitempty"`
}

// RefreshSupportClientCapabilities declares support for a global refresh
// request initiated by the language server.
type RefreshSupportClientCapabilities struct {
	RefreshSupport bool `json:"refreshSupport,omitempty"`
}

// TextDocumentClientCapabilities contains document-oriented client support.
type TextDocumentClientCapabilities struct {
	Hover *HoverClientCapabilities `json:"hover,omitempty"`
}

// HoverClientCapabilities declares the client's preferred content formats.
type HoverClientCapabilities struct {
	ContentFormat []MarkupKind `json:"contentFormat,omitempty"`
}

// HoverParams identifies the document position being inspected.
type HoverParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

// MarkupContent is an LSP markdown or plaintext payload.
type MarkupContent struct {
	Kind  MarkupKind `json:"kind"`
	Value string     `json:"value"`
}

// Hover describes matching content and its displayed source range.
type Hover struct {
	Contents MarkupContent `json:"contents"`
	Range    *Range        `json:"range,omitempty"`
}
