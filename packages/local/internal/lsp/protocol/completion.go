package protocol

import "encoding/json"

// CompletionParams identifies the current document cursor.
type CompletionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

// CompletionList carries eager completion items and truncation state.
type CompletionList struct {
	IsIncomplete bool             `json:"isIncomplete"`
	Items        []CompletionItem `json:"items"`
}

// CompletionItem is one eager, self-contained editor completion.
type CompletionItem struct {
	Label               string          `json:"label"`
	Kind                CompletionKind  `json:"kind,omitempty"`
	Detail              string          `json:"detail,omitempty"`
	SortText            string          `json:"sortText,omitempty"`
	FilterText          string          `json:"filterText,omitempty"`
	TextEdit            *TextEdit       `json:"textEdit,omitempty"`
	AdditionalTextEdits []TextEdit      `json:"additionalTextEdits,omitempty"`
	Data                json.RawMessage `json:"data,omitempty"`
}

// CompletionKind is an LSP CompletionItemKind value.
type CompletionKind int

const (
	// CompletionKindReference identifies an authored definition reference.
	CompletionKindReference CompletionKind = 18
)
