package server

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

// DefinitionLocation resolves a navigable site within the most-specific scope
// containing uri. Definitions do not jump to themselves.
func (w *workspaceRuntime) DefinitionLocation(
	uri protocol.DocumentURI,
	position protocol.Position,
) (protocol.Location, bool) {
	session := w.navigationSession(uri)
	view, ok := w.savedNavigationView(session, uri)
	if !ok {
		return protocol.Location{}, false
	}
	publisher := session.publisher
	if site, ok := publisher.siteAtPublication(uri, position, view.Publication); ok {
		definition, found := publisher.definitionFromPublication(
			site.Site.TargetDefinitionID,
			view.Publication,
		)
		if !found {
			return protocol.Location{}, false
		}
		return publisher.definitionLocation(definition)
	}
	// With no navigation site, both a definition self-jump and a miss are null.
	return protocol.Location{}, false
}

// ReferenceLocations resolves a target within one scope and returns its
// declaration optionally followed by deterministic whole-line reference sites.
func (w *workspaceRuntime) ReferenceLocations(
	uri protocol.DocumentURI,
	position protocol.Position,
	includeDeclaration bool,
) []protocol.Location {
	session := w.navigationSession(uri)
	view, ok := w.savedNavigationView(session, uri)
	if !ok {
		return nil
	}
	publisher := session.publisher
	definition, ok := publisher.navigationDefinitionAtPublication(uri, position, view.Publication)
	if !ok {
		return nil
	}
	result := make([]protocol.Location, 0)
	if includeDeclaration {
		if declaration, found := publisher.definitionLocation(definition); found {
			result = append(result, declaration)
		}
	}
	for _, site := range publisher.referencesToPublication(definition.Definition.ID, view.Publication) {
		referenceURI, _ := publisher.mapper.MapSourceLoc(site.Site.Source)
		line := site.Range.Start.Line
		result = append(result, protocol.Location{
			URI: referenceURI,
			Range: protocol.Range{
				Start: protocol.Position{Line: line},
				End:   protocol.Position{Line: line + 1},
			},
		})
	}
	return result
}

func (w *workspaceRuntime) navigationSession(uri protocol.DocumentURI) *scopeSession {
	sessions := w.sessionsForURI(uri)
	if len(sessions) == 0 {
		return nil
	}
	selected := sessions[0]
	for _, candidate := range sessions[1:] {
		if len(filepath.Clean(candidate.scope.Root)) > len(filepath.Clean(selected.scope.Root)) {
			selected = candidate
		}
	}
	return selected
}

func (w *workspaceRuntime) navigationPublisher(uri protocol.DocumentURI) *Publisher {
	session := w.navigationSession(uri)
	if session == nil {
		return nil
	}
	return session.publisher
}

func (p *Publisher) navigationDefinitionAtPublication(
	uri protocol.DocumentURI,
	position protocol.Position,
	publication readmodel.Publication,
) (documentDefinition, bool) {
	if site, ok := p.siteAtPublication(uri, position, publication); ok {
		return p.definitionFromPublication(site.Site.TargetDefinitionID, publication)
	}
	return p.definitionAtPublication(uri, position, publication)
}

func (w *workspaceRuntime) savedNavigationView(
	session *scopeSession,
	uri protocol.DocumentURI,
) (*indexview.ProjectIndexView, bool) {
	if session == nil || session.publisher == nil {
		return nil, false
	}
	file, err := mapping.URIToPath(string(uri))
	if err != nil {
		return nil, false
	}
	provider := session.views
	if provider == nil {
		provider = indexview.NewSavedProvider(session.publisher.options.Store)
	}
	selection := provider.BestAvailableView(indexview.ViewRequest{
		ScopeID: session.scope.ID, File: file,
		MinimumEvidence: indexview.EvidenceSemantic,
		Freshness:       indexview.AllowSavedFallback,
	})
	if selection.Status == indexview.ViewStatusUnavailable || selection.View == nil {
		return nil, false
	}
	return selection.View, true
}

func (p *Publisher) definitionLocation(definition documentDefinition) (protocol.Location, bool) {
	uri, _, ok := p.mapDefinition(definition.Definition)
	if !ok {
		return protocol.Location{}, false
	}
	return protocol.Location{URI: uri, Range: definition.Range}, true
}
