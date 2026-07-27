package protocol

// DocumentLinkParams identifies the open document whose links are requested.
type DocumentLinkParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// DocumentLinkOptions declares that all targets are returned eagerly.
type DocumentLinkOptions struct {
	ResolveProvider bool `json:"resolveProvider"`
}

// DocumentLink identifies one clickable source range and its eager final
// target. Crux intentionally exposes neither data nor tooltip fields.
type DocumentLink struct {
	Range  Range       `json:"range"`
	Target DocumentURI `json:"target"`
}
