package server

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// DefinitionLocation resolves a navigable site within the most-specific scope
// containing uri. Definitions do not jump to themselves.
func (w *workspaceRuntime) DefinitionLocation(
	uri protocol.DocumentURI,
	position protocol.Position,
) (protocol.Location, bool) {
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return protocol.Location{}, false
	}
	if site, ok := publisher.SiteAt(uri, position); ok {
		definition, found := publisher.Definition(site.Site.TargetDefinitionID)
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
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return nil
	}
	definition, ok := publisher.navigationDefinitionAt(uri, position)
	if !ok {
		return nil
	}
	result := make([]protocol.Location, 0)
	if includeDeclaration {
		if declaration, found := publisher.definitionLocation(definition); found {
			result = append(result, declaration)
		}
	}
	for _, site := range publisher.ReferencesTo(definition.Definition.ID) {
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

func (w *workspaceRuntime) navigationPublisher(uri protocol.DocumentURI) *Publisher {
	session := w.navigationSession(uri)
	if session == nil {
		return nil
	}
	return session.publisher
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

func (p *Publisher) navigationDefinitionAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) (documentDefinition, bool) {
	if site, ok := p.SiteAt(uri, position); ok {
		return p.Definition(site.Site.TargetDefinitionID)
	}
	return p.DefinitionAt(uri, position)
}

func (p *Publisher) definitionLocation(definition documentDefinition) (protocol.Location, bool) {
	uri, _, ok := p.mapDefinition(definition.Definition)
	if !ok {
		return protocol.Location{}, false
	}
	return protocol.Location{URI: uri, Range: definition.Range}, true
}
