package server

import "github.com/use-crux/crux/packages/local/internal/lsp/protocol"

// DocumentSymbols returns the flat, displayed definition list for the
// most-specific configured scope containing uri.
func (w *workspaceRuntime) DocumentSymbols(uri protocol.DocumentURI) []protocol.DocumentSymbol {
	result := make([]protocol.DocumentSymbol, 0)
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return result
	}
	for _, definition := range publisher.DefinitionsIn(uri) {
		name := definition.Definition.Name
		if name == "" {
			name = definition.Definition.ID
		}
		anchor := definition.Range.Start
		result = append(result, protocol.DocumentSymbol{
			Name: name, Detail: definition.Definition.Kind,
			Kind: symbolKind(definition.Definition.Kind), Range: definition.Range,
			SelectionRange: protocol.Range{Start: anchor, End: anchor},
		})
	}
	return result
}
