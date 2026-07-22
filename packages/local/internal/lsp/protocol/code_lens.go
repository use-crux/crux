package protocol

// CodeLensParams identifies the document whose lenses are requested.
type CodeLensParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// CodeLens displays a command title at a source line.
type CodeLens struct {
	Range   Range    `json:"range"`
	Command *Command `json:"command"`
}
