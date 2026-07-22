package server

import (
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// DefinitionAt returns the definition whose displayed range contains the
// requested position. Non-zero ranges use an exclusive end; zero-width ranges
// match only their exact position.
func (p *Publisher) DefinitionAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) (documentDefinition, bool) {
	view, open := p.openDocumentView(uri)
	if !open {
		publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
		view = p.currentDocumentView(uri, publication, nil, nil)
	}
	for _, definition := range view.definitions {
		if rangeContainsPosition(definition.Range, position) {
			return definition, true
		}
	}
	return documentDefinition{}, false
}

// DefinitionsIn returns detached definitions ordered by displayed position
// for an open, closed, or never-opened document.
func (p *Publisher) DefinitionsIn(uri protocol.DocumentURI) []documentDefinition {
	view, open := p.openDocumentView(uri)
	if !open {
		publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
		view = p.currentDocumentView(uri, publication, nil, nil)
	}
	sort.Slice(view.definitions, func(left, right int) bool {
		return definitionResultLess(view.definitions[left], view.definitions[right])
	})
	return view.definitions
}

// Definition returns one view-aware definition location by stable ID. A Store
// definition belonging to an open URI is hidden unless it is present in that
// URI's displayed view.
func (p *Publisher) Definition(id string) (documentDefinition, bool) {
	open := p.openDocumentViews()
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	displayed := make([]documentDefinition, 0, 1)
	for _, view := range open {
		for _, definition := range view.definitions {
			if definition.Definition.ID == id {
				displayed = append(displayed, definition)
			}
		}
	}
	if len(displayed) > 0 {
		sort.Slice(displayed, func(left, right int) bool {
			return definitionResultLess(displayed[left], displayed[right])
		})
		return displayed[0], true
	}
	definition, ok := publication.DefinitionsByID[id]
	if !ok {
		return documentDefinition{}, false
	}
	uri, mapped, ok := p.mapDefinition(definition)
	if !ok {
		return documentDefinition{}, false
	}
	if _, hidden := open[uri]; hidden {
		return documentDefinition{}, false
	}
	return mapped, true
}

// AllDefinitions returns every displayed definition whose name or ID contains
// query case-insensitively. Store rows from open URIs are replaced wholesale
// by those documents' displayed views before filtering and sorting.
func (p *Publisher) AllDefinitions(query string) []documentDefinition {
	open := p.openDocumentViews()
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	result := make([]documentDefinition, 0)
	for _, definitions := range publication.DefinitionsByFile {
		for _, definition := range definitions {
			uri, mapped, ok := p.mapDefinition(definition)
			if !ok {
				continue
			}
			if _, substituted := open[uri]; !substituted {
				result = append(result, mapped)
			}
		}
	}
	for _, view := range open {
		result = append(result, view.definitions...)
	}
	needle := strings.ToLower(query)
	if needle != "" {
		filtered := result[:0]
		for _, definition := range result {
			if strings.Contains(strings.ToLower(definition.Definition.Name), needle) ||
				strings.Contains(strings.ToLower(definition.Definition.ID), needle) {
				filtered = append(filtered, definition)
			}
		}
		result = filtered
	}
	sort.Slice(result, func(left, right int) bool {
		return definitionResultLess(result[left], result[right])
	})
	return result
}

func definitionResultLess(left, right documentDefinition) bool {
	leftFile, rightFile := definitionFile(left.Definition), definitionFile(right.Definition)
	switch {
	case leftFile != rightFile:
		return leftFile < rightFile
	case left.Range.Start.Line != right.Range.Start.Line:
		return left.Range.Start.Line < right.Range.Start.Line
	case left.Range.Start.Character != right.Range.Start.Character:
		return left.Range.Start.Character < right.Range.Start.Character
	default:
		return left.Definition.ID < right.Definition.ID
	}
}

func definitionFile(definition api.ProjectDefinition) string {
	if definition.SourceSnippet != nil && definition.SourceSnippet.Range.File != "" &&
		definition.SourceSnippet.Range.StartLine > 0 {
		return definition.SourceSnippet.Range.File
	}
	if definition.Source != nil {
		return definition.Source.File
	}
	return ""
}
