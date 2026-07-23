package server

import (
	"path/filepath"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type scopedWorkspaceSymbol struct {
	definition documentDefinition
	location   protocol.Location
	container  string
}

// WorkspaceSymbols returns globally sorted symbols from every configured
// scope. The boolean reports whether the result exceeded the protocol cap.
func (w *workspaceRuntime) WorkspaceSymbols(query string) ([]protocol.SymbolInformation, bool) {
	w.mu.Lock()
	sessions := append([]*scopeSession(nil), w.sessions...)
	w.mu.Unlock()

	values := make([]scopedWorkspaceSymbol, 0)
	for _, session := range sessions {
		for _, definition := range session.publisher.AllDefinitions(query) {
			location, ok := session.publisher.definitionLocation(definition)
			if !ok {
				continue
			}
			values = append(values, scopedWorkspaceSymbol{
				definition: definition,
				location:   location,
				container:  session.folderName,
			})
		}
	}
	sort.Slice(values, func(left, right int) bool {
		return scopedWorkspaceSymbolLess(values[left], values[right])
	})
	capped := len(values) > workspaceSymbolLimit
	if capped {
		values = values[:workspaceSymbolLimit]
	}
	result := make([]protocol.SymbolInformation, len(values))
	for index, value := range values {
		name := value.definition.Definition.Name
		if name == "" {
			name = value.definition.Definition.ID
		}
		result[index] = protocol.SymbolInformation{
			Name: name, Kind: symbolKind(value.definition.Definition.Kind),
			Location: value.location, ContainerName: value.container,
		}
	}
	return result, capped
}

func scopedWorkspaceSymbolLess(left, right scopedWorkspaceSymbol) bool {
	switch {
	case left.location.URI != right.location.URI:
		return left.location.URI < right.location.URI
	case left.location.Range.Start.Line != right.location.Range.Start.Line:
		return left.location.Range.Start.Line < right.location.Range.Start.Line
	case left.location.Range.Start.Character != right.location.Range.Start.Character:
		return left.location.Range.Start.Character < right.location.Range.Start.Character
	case left.definition.Definition.ID != right.definition.Definition.ID:
		return left.definition.Definition.ID < right.definition.Definition.ID
	case left.definition.Definition.Name != right.definition.Definition.Name:
		return left.definition.Definition.Name < right.definition.Definition.Name
	default:
		return left.container < right.container
	}
}

func workspaceFolderName(root string, folders []protocol.WorkspaceFolder) string {
	cleanRoot := filepath.Clean(root)
	for _, folder := range folders {
		path, err := mapping.URIToPath(string(folder.URI))
		if err == nil && filepath.Clean(path) == cleanRoot && folder.Name != "" {
			return folder.Name
		}
	}
	return filepath.Base(cleanRoot)
}
