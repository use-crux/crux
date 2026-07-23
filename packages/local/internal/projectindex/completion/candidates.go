package completion

import (
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func candidates(view View, requestFile string) []staticprotocol.CompletionCandidate {
	currentFile := completionFile(view.ProjectRoot, requestFile)
	result := make([]staticprotocol.CompletionCandidate, 0, len(view.Definitions))
	for _, definition := range view.Definitions {
		binding, exported := exportBinding(definition.Metadata)
		file, line, column, ok := definitionBinding(definition)
		candidateFile := completionFile(view.ProjectRoot, file)
		if !ok || binding == "" || definition.ID == "" || definition.Kind == "" ||
			(candidateFile != currentFile && !exported) {
			continue
		}
		result = append(result, staticprotocol.CompletionCandidate{
			ID: definition.ID, Kind: definition.Kind, Name: definition.Name,
			Binding: binding, File: candidateFile,
			Line: uint32(line), Character: uint32(column), Description: definition.Description,
		})
	}
	sort.Slice(result, func(left, right int) bool {
		if result[left].File != result[right].File {
			return result[left].File < result[right].File
		}
		return result[left].ID < result[right].ID
	})
	return result
}

func definitionBinding(definition api.ProjectDefinition) (file string, line, column int, ok bool) {
	if definition.SourceSnippet != nil && definition.SourceSnippet.Range.File != "" &&
		definition.SourceSnippet.Range.StartLine > 0 {
		range_ := definition.SourceSnippet.Range
		if range_.StartColumn != nil && *range_.StartColumn > 0 {
			column = *range_.StartColumn
		}
		return range_.File, range_.StartLine, column, true
	}
	if definition.Source == nil || definition.Source.File == "" || definition.Source.Line <= 0 {
		return "", 0, 0, false
	}
	if definition.Source.Column != nil && *definition.Source.Column > 0 {
		column = *definition.Source.Column
	}
	return definition.Source.File, definition.Source.Line, column, true
}

func completionFile(root, file string) string {
	if filepath.IsAbs(file) || root == "" {
		return filepath.Clean(file)
	}
	return filepath.Join(root, file)
}

func exportBinding(metadata json.RawMessage) (string, bool) {
	if len(metadata) == 0 {
		return "", false
	}
	var value struct {
		ExportName string `json:"exportName"`
		Exported   bool   `json:"exported"`
	}
	if json.Unmarshal(metadata, &value) != nil {
		return "", false
	}
	binding := strings.TrimSpace(value.ExportName)
	if binding == "default" {
		return "", false
	}
	return binding, value.Exported
}
