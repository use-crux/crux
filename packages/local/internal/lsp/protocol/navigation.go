package protocol

// DefinitionParams identifies the document position whose target is requested.
type DefinitionParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
}

// ReferenceParams identifies the document position whose references are requested.
type ReferenceParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
	Position     Position               `json:"position"`
	Context      ReferenceContext       `json:"context"`
}

// ReferenceContext controls whether the declaration is included with references.
type ReferenceContext struct {
	IncludeDeclaration bool `json:"includeDeclaration"`
}

// DocumentSymbolParams identifies the document whose symbols are requested.
type DocumentSymbolParams struct {
	TextDocument TextDocumentIdentifier `json:"textDocument"`
}

// WorkspaceSymbolParams carries the client-provided workspace symbol query.
type WorkspaceSymbolParams struct {
	Query string `json:"query"`
}

// SymbolKind classifies a symbol using the LSP SymbolKind enumeration.
type SymbolKind int

const (
	SymbolKindClass     SymbolKind = 5
	SymbolKindMethod    SymbolKind = 6
	SymbolKindInterface SymbolKind = 11
	SymbolKindFunction  SymbolKind = 12
	SymbolKindString    SymbolKind = 15
	SymbolKindObject    SymbolKind = 19
	SymbolKindEvent     SymbolKind = 24
	SymbolKindOperator  SymbolKind = 25
)

// DocumentSymbol describes one symbol inside a document.
type DocumentSymbol struct {
	Name           string           `json:"name"`
	Detail         string           `json:"detail,omitempty"`
	Kind           SymbolKind       `json:"kind"`
	Range          Range            `json:"range"`
	SelectionRange Range            `json:"selectionRange"`
	Children       []DocumentSymbol `json:"children,omitempty"`
}

// SymbolInformation describes one symbol and its workspace location.
type SymbolInformation struct {
	Name          string     `json:"name"`
	Kind          SymbolKind `json:"kind"`
	Location      Location   `json:"location"`
	ContainerName string     `json:"containerName,omitempty"`
}
