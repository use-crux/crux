package protocol

// FoldingRangeParams identifies the open document whose structural folds are
// requested.
type FoldingRangeParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// FoldingRange describes one multiline, zero-based UTF-16 source region.
//
// EndLine is inclusive under LSP. Optional character offsets retain exact
// bounds when a fold ends within a line; omitted offsets use the line end.
type FoldingRange struct {
	StartLine      uint32  `json:"startLine"`
	StartCharacter *uint32 `json:"startCharacter,omitempty"`
	EndLine        uint32  `json:"endLine"`
	EndCharacter   *uint32 `json:"endCharacter,omitempty"`
	Kind           string  `json:"kind,omitempty"`
	CollapsedText  string  `json:"collapsedText,omitempty"`
}
