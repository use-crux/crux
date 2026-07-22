package protocol

// InlayHintParams identifies the visible document range to annotate.
type InlayHintParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Range        Range                  `json:"range"`
}

// InlayHint is a non-editing annotation rendered inside a document.
type InlayHint struct {
	Position    Position       `json:"position"`
	Label       string         `json:"label"`
	Tooltip     *MarkupContent `json:"tooltip,omitempty"`
	PaddingLeft bool           `json:"paddingLeft,omitempty"`
}
