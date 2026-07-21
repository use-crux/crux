package server

import (
	"reflect"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/store"
)

type indexDeltaMessage struct {
	Type        string                  `json:"type"`
	Generation  uint64                  `json:"generation"`
	File        string                  `json:"file"`
	Definitions indexDeltaDefinitions   `json:"definitions"`
	Diagnostics []store.IndexDiagnostic `json:"diagnostics"`
	SourceRow   *store.IndexSourceFile  `json:"sourceRow"`
	Lints       *indexDeltaLints        `json:"lints,omitempty"`
}

type indexDeltaDefinitions struct {
	Added      []store.ProjectDefinition `json:"added"`
	Changed    []store.ProjectDefinition `json:"changed"`
	RemovedIDs []string                  `json:"removedIds"`
}

func (h *WSHub) indexUpdateMessages(index store.IndexData) []any {
	h.indexMu.Lock()
	previous := h.lastIndex
	hasPrevious := h.hasLastIndex
	h.lastIndex = index
	h.hasLastIndex = true
	h.indexGeneration++
	generation := h.indexGeneration
	h.indexMu.Unlock()

	if !hasPrevious {
		return []any{h.indexMessage(index, generation)}
	}
	deltas := indexDeltaMessages(previous, index, generation)
	if len(deltas) == 0 {
		if reflect.DeepEqual(previous, index) {
			return nil
		}
		return []any{h.indexMessage(index, generation)}
	}
	if !indexDeltaCoversChange(previous, index) {
		return []any{h.indexMessage(index, generation)}
	}
	messages := make([]any, 0, len(deltas))
	for _, delta := range deltas {
		messages = append(messages, delta)
	}
	return messages
}

func indexDeltaCoversChange(previous store.IndexData, current store.IndexData) bool {
	previous.Sources = nil
	previous.Definitions = nil
	previous.Diagnostics = nil
	previous.LintFindings = nil
	current.Sources = nil
	current.Definitions = nil
	current.Diagnostics = nil
	current.LintFindings = nil
	return reflect.DeepEqual(previous, current)
}

func indexDeltaMessages(previous store.IndexData, current store.IndexData, generation uint64) []indexDeltaMessage {
	files := changedIndexFiles(previous, current)
	messages := make([]indexDeltaMessage, 0, len(files))
	for _, file := range files {
		messages = append(messages, indexDeltaMessage{
			Type:        "index:delta",
			Generation:  generation,
			File:        file,
			Definitions: indexDefinitionDeltaForFile(file, previous.Definitions, current.Definitions),
			Diagnostics: diagnosticsForFile(file, current.Diagnostics),
			SourceRow:   sourceRowForFile(file, current.Sources),
			Lints:       lintDeltaForFile(file, previous.LintFindings, current.LintFindings),
		})
	}
	return messages
}

func changedIndexFiles(previous store.IndexData, current store.IndexData) []string {
	files := map[string]bool{}
	for file, previousRow := range sourceRowsByFile(previous.Sources) {
		currentRow, ok := sourceRowsByFile(current.Sources)[file]
		if !ok || !reflect.DeepEqual(previousRow, currentRow) {
			files[file] = true
		}
	}
	for file, currentRow := range sourceRowsByFile(current.Sources) {
		previousRow, ok := sourceRowsByFile(previous.Sources)[file]
		if !ok || !reflect.DeepEqual(previousRow, currentRow) {
			files[file] = true
		}
	}
	for _, file := range changedDefinitionFiles(previous.Definitions, current.Definitions) {
		files[file] = true
	}
	for _, file := range changedDiagnosticFiles(previous.Diagnostics, current.Diagnostics) {
		files[file] = true
	}
	for _, file := range changedLintFiles(previous.LintFindings, current.LintFindings) {
		files[file] = true
	}
	out := make([]string, 0, len(files))
	for file := range files {
		out = append(out, file)
	}
	sort.Strings(out)
	return out
}

func changedDefinitionFiles(previous []store.ProjectDefinition, current []store.ProjectDefinition) []string {
	files := map[string]bool{}
	previousByID := definitionsByID(previous)
	currentByID := definitionsByID(current)
	for id, previousDefinition := range previousByID {
		currentDefinition, ok := currentByID[id]
		if !ok || !reflect.DeepEqual(previousDefinition, currentDefinition) {
			files[definitionFile(previousDefinition)] = true
			files[definitionFile(currentDefinition)] = true
		}
	}
	for id, currentDefinition := range currentByID {
		previousDefinition, ok := previousByID[id]
		if !ok || !reflect.DeepEqual(previousDefinition, currentDefinition) {
			files[definitionFile(previousDefinition)] = true
			files[definitionFile(currentDefinition)] = true
		}
	}
	return mapKeysSorted(files)
}

func changedDiagnosticFiles(previous []store.IndexDiagnostic, current []store.IndexDiagnostic) []string {
	files := map[string]bool{}
	previousByID := diagnosticsByID(previous)
	currentByID := diagnosticsByID(current)
	for id, previousDiagnostic := range previousByID {
		currentDiagnostic, ok := currentByID[id]
		if !ok || !reflect.DeepEqual(previousDiagnostic, currentDiagnostic) {
			files[diagnosticFile(previousDiagnostic)] = true
			files[diagnosticFile(currentDiagnostic)] = true
		}
	}
	for id, currentDiagnostic := range currentByID {
		previousDiagnostic, ok := previousByID[id]
		if !ok || !reflect.DeepEqual(previousDiagnostic, currentDiagnostic) {
			files[diagnosticFile(previousDiagnostic)] = true
			files[diagnosticFile(currentDiagnostic)] = true
		}
	}
	return mapKeysSorted(files)
}

func indexDefinitionDeltaForFile(file string, previous []store.ProjectDefinition, current []store.ProjectDefinition) indexDeltaDefinitions {
	previousByID := definitionsByID(previous)
	currentByID := definitionsByID(current)
	added := []store.ProjectDefinition{}
	changed := []store.ProjectDefinition{}
	removedIDs := []string{}

	for id, previousDefinition := range previousByID {
		currentDefinition, ok := currentByID[id]
		if definitionFile(previousDefinition) == file && (!ok || definitionFile(currentDefinition) != file) {
			removedIDs = append(removedIDs, id)
		}
	}
	for id, currentDefinition := range currentByID {
		if definitionFile(currentDefinition) != file {
			continue
		}
		previousDefinition, ok := previousByID[id]
		if !ok || definitionFile(previousDefinition) != file {
			added = append(added, currentDefinition)
			continue
		}
		if !reflect.DeepEqual(previousDefinition, currentDefinition) {
			changed = append(changed, currentDefinition)
		}
	}
	sort.Slice(added, func(i, j int) bool { return added[i].ID < added[j].ID })
	sort.Slice(changed, func(i, j int) bool { return changed[i].ID < changed[j].ID })
	sort.Strings(removedIDs)
	return indexDeltaDefinitions{Added: added, Changed: changed, RemovedIDs: removedIDs}
}

func definitionsByID(definitions []store.ProjectDefinition) map[string]store.ProjectDefinition {
	out := map[string]store.ProjectDefinition{}
	for _, definition := range definitions {
		out[definition.ID] = definition
	}
	return out
}

func diagnosticsByID(diagnostics []store.IndexDiagnostic) map[string]store.IndexDiagnostic {
	out := map[string]store.IndexDiagnostic{}
	for _, diagnostic := range diagnostics {
		out[diagnostic.ID] = diagnostic
	}
	return out
}

func sourceRowsByFile(sources []store.IndexSourceFile) map[string]store.IndexSourceFile {
	out := map[string]store.IndexSourceFile{}
	for _, source := range sources {
		out[source.File] = source
	}
	return out
}

func definitionFile(definition store.ProjectDefinition) string {
	if definition.Source == nil {
		return ""
	}
	return definition.Source.File
}

func diagnosticFile(diagnostic store.IndexDiagnostic) string {
	if diagnostic.Source == nil {
		return ""
	}
	return diagnostic.Source.File
}

func diagnosticsForFile(file string, diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
	out := []store.IndexDiagnostic{}
	for _, diagnostic := range diagnostics {
		if diagnosticFile(diagnostic) == file {
			out = append(out, diagnostic)
		}
	}
	return out
}

func sourceRowForFile(file string, sources []store.IndexSourceFile) *store.IndexSourceFile {
	for _, source := range sources {
		if source.File == file {
			row := source
			return &row
		}
	}
	return nil
}

func mapKeysSorted(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			out = append(out, value)
		}
	}
	sort.Strings(out)
	return out
}
