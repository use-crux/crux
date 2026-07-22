package server

import (
	"path/filepath"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

type documentDefinition struct {
	Definition api.ProjectDefinition
	Range      protocol.Range
	// FirstLineEnd is the retained, transformable inlay-hint anchor derived
	// from SourceSnippet text, or Range.Start when no snippet text is usable.
	FirstLineEnd protocol.Position
}

type documentNavigationSite struct {
	Site  readmodel.NavigationSite
	Range protocol.Range
}

type definitionRelationCount struct {
	Incoming int
	Outgoing int
}

type documentView struct {
	diagnostics    []protocol.Diagnostic
	findings       map[string]api.IndexLintFinding
	definitions    []documentDefinition
	relationCounts map[string]definitionRelationCount
	sites          []documentNavigationSite
}

func (p *Publisher) currentDocumentView(
	uri protocol.DocumentURI,
	publication readmodel.Publication,
	diagnostics []protocol.Diagnostic,
	findings map[string]api.IndexLintFinding,
) documentView {
	view := documentView{diagnostics: diagnostics, findings: findings}
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
		return view
	}
	definitions := publication.DefinitionsByFile[file]
	sites := publication.SitesByFile[file]
	if len(definitions) == 0 && len(sites) == 0 && filepath.IsAbs(file) {
		if relative, relativeErr := filepath.Rel(p.options.Root, file); relativeErr == nil {
			definitions = publication.DefinitionsByFile[relative]
			sites = publication.SitesByFile[relative]
		}
	}
	for _, definition := range definitions {
		mapped, ok := p.mapDocumentDefinition(uri, definition)
		if ok {
			view.definitions = append(view.definitions, mapped)
		}
	}
	view.relationCounts = countDefinitionRelations(view.definitions, publication.Relations)
	for _, site := range sites {
		mappedURI, mappedRange := p.mapper.MapSourceLoc(site.Source)
		if mappedURI == uri {
			view.sites = append(view.sites, documentNavigationSite{Site: site, Range: mappedRange})
		}
	}
	return view
}

func (p *Publisher) mapDocumentDefinition(
	uri protocol.DocumentURI,
	definition api.ProjectDefinition,
) (documentDefinition, bool) {
	mappedURI, mapped, ok := p.mapDefinition(definition)
	return mapped, ok && mappedURI == uri
}

func (p *Publisher) mapDefinition(
	definition api.ProjectDefinition,
) (protocol.DocumentURI, documentDefinition, bool) {
	if definition.SourceSnippet != nil {
		source := definition.SourceSnippet.Range
		if source.File != "" && source.StartLine > 0 {
			mappedURI, mappedRange := p.mapper.MapSourceRange(source)
			return mappedURI, documentDefinition{
				Definition:   definition,
				Range:        mappedRange,
				FirstLineEnd: definitionFirstLineEnd(definition, mappedRange.Start),
			}, true
		}
	}
	if definition.Source == nil || definition.Source.File == "" || definition.Source.Line <= 0 {
		return "", documentDefinition{}, false
	}
	source := *definition.Source
	source.Column = nil
	mappedURI, mappedRange := p.mapper.MapSourceLoc(source)
	return mappedURI, documentDefinition{
		Definition: definition, Range: mappedRange, FirstLineEnd: mappedRange.Start,
	}, true
}

func definitionFirstLineEnd(
	definition api.ProjectDefinition,
	start protocol.Position,
) protocol.Position {
	if definition.SourceSnippet == nil || definition.SourceSnippet.Source == "" {
		return start
	}
	firstLine, _, _ := strings.Cut(definition.SourceSnippet.Source, "\n")
	firstLine = strings.TrimSuffix(firstLine, "\r")
	return protocol.Position{
		Line: start.Line, Character: start.Character + uint32(utf16Units(firstLine)),
	}
}

func transformDocumentView(
	uri protocol.DocumentURI,
	view documentView,
	changes []protocol.TextDocumentContentChangeEvent,
) (documentView, bool, bool) {
	result := cloneDocumentView(view)
	var diagnosticsChanged bool
	result.diagnostics, diagnosticsChanged = applyDocumentChanges(uri, view.diagnostics, changes)
	ranges := make([]protocol.Range, 0, len(view.definitions)*2+len(view.sites))
	for _, definition := range view.definitions {
		ranges = append(ranges, definition.Range)
	}
	for _, definition := range view.definitions {
		ranges = append(ranges, protocol.Range{
			Start: definition.FirstLineEnd, End: definition.FirstLineEnd,
		})
	}
	for _, site := range view.sites {
		ranges = append(ranges, site.Range)
	}
	ranges, navigationChanged := applyRangeChanges(ranges, changes)
	for index := range result.definitions {
		result.definitions[index].Range = ranges[index]
		result.definitions[index].FirstLineEnd = ranges[len(result.definitions)+index].Start
	}
	for index := range result.sites {
		result.sites[index].Range = ranges[len(result.definitions)*2+index]
	}
	return result, diagnosticsChanged, navigationChanged
}

func cloneDocumentView(view documentView) documentView {
	result := view
	result.diagnostics = cloneDiagnostics(view.diagnostics)
	result.findings = cloneFindingMap(view.findings)
	result.definitions = append([]documentDefinition(nil), view.definitions...)
	result.relationCounts = cloneDefinitionRelationCounts(view.relationCounts)
	result.sites = append([]documentNavigationSite(nil), view.sites...)
	return result
}

func (p *Publisher) openDocumentView(uri protocol.DocumentURI) (documentView, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	document := p.documents[uri]
	if p.closed || document == nil || !document.open {
		return documentView{}, false
	}
	return detachDocumentView(document.view), true
}

func (p *Publisher) openDocumentViews() map[protocol.DocumentURI]documentView {
	p.mu.Lock()
	defer p.mu.Unlock()
	result := make(map[protocol.DocumentURI]documentView)
	if p.closed {
		return result
	}
	for uri, document := range p.documents {
		if document.open {
			result[uri] = detachDocumentView(document.view)
		}
	}
	return result
}

func detachDocumentView(view documentView) documentView {
	result := cloneDocumentView(view)
	for index := range result.definitions {
		result.definitions[index].Definition = detachDefinition(result.definitions[index].Definition)
	}
	for index := range result.sites {
		result.sites[index].Site.Source = detachSourceLoc(result.sites[index].Site.Source)
	}
	return result
}

func detachDefinition(definition api.ProjectDefinition) api.ProjectDefinition {
	result := definition
	result.Tags = append([]string(nil), definition.Tags...)
	result.Path = append([]string(nil), definition.Path...)
	result.Metadata = append([]byte(nil), definition.Metadata...)
	if definition.Source != nil {
		source := detachSourceLoc(*definition.Source)
		result.Source = &source
	}
	result.SourceSnippet = detachSourceSnippet(definition.SourceSnippet)
	result.SourceRefs = append([]api.ProjectSourceRef(nil), definition.SourceRefs...)
	for index := range result.SourceRefs {
		ref := &result.SourceRefs[index]
		ref.Source = detachSourceLoc(ref.Source)
		ref.Snippet = detachSourceSnippet(ref.Snippet)
		ref.Metadata = detachMetadata(ref.Metadata)
	}
	return result
}

func detachSourceLoc(source api.SourceLoc) api.SourceLoc {
	result := source
	if source.Column != nil {
		column := *source.Column
		result.Column = &column
	}
	return result
}

func detachSourceSnippet(source *api.SourceSnippet) *api.SourceSnippet {
	if source == nil {
		return nil
	}
	result := *source
	result.Range = detachSourceRange(source.Range)
	return &result
}

func detachSourceRange(source api.SourceRange) api.SourceRange {
	result := source
	if source.EndLine != nil {
		value := *source.EndLine
		result.EndLine = &value
	}
	if source.StartColumn != nil {
		value := *source.StartColumn
		result.StartColumn = &value
	}
	if source.EndColumn != nil {
		value := *source.EndColumn
		result.EndColumn = &value
	}
	return result
}

func detachMetadata(metadata map[string]any) map[string]any {
	if metadata == nil {
		return nil
	}
	result := make(map[string]any, len(metadata))
	for key, value := range metadata {
		result[key] = detachMetadataValue(value)
	}
	return result
}

func detachMetadataValue(value any) any {
	switch value := value.(type) {
	case map[string]any:
		return detachMetadata(value)
	case []any:
		result := make([]any, len(value))
		for index, item := range value {
			result[index] = detachMetadataValue(item)
		}
		return result
	case []string:
		return append([]string(nil), value...)
	case []byte:
		return append([]byte(nil), value...)
	default:
		return value
	}
}
