package server

import (
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

// navigationDocumentView combines records from one selected publication with
// ranges already transformed into an open buffer. Stable IDs are the join:
// removed records disappear, and newly added records remain hidden until the
// open document has an authoritative range for them.
func (p *Publisher) navigationDocumentView(
	uri protocol.DocumentURI,
	publication readmodel.Publication,
) documentView {
	selected := p.currentDocumentView(uri, publication, nil, nil)
	displayed, open := p.openDocumentView(uri)
	if !open {
		return selected
	}

	definitions := make([]documentDefinition, 0, len(selected.definitions))
	for _, definition := range selected.definitions {
		displayedRange, firstLineEnd, found := displayedDefinitionRange(
			displayed,
			definition.Definition.ID,
		)
		if !found {
			continue
		}
		definition.Range = displayedRange
		definition.FirstLineEnd = firstLineEnd
		definitions = append(definitions, definition)
	}
	selected.definitions = definitions

	sites := make([]documentNavigationSite, 0, len(selected.sites))
	for _, site := range selected.sites {
		displayedRange, found := displayedNavigationRange(displayed, site.Site.ID)
		if !found {
			continue
		}
		site.Range = displayedRange
		sites = append(sites, site)
	}
	selected.sites = sites
	return selected
}

func displayedDefinitionRange(
	view documentView,
	id string,
) (protocol.Range, protocol.Position, bool) {
	for _, definition := range view.definitions {
		if definition.Definition.ID == id {
			return definition.Range, definition.FirstLineEnd, true
		}
	}
	return protocol.Range{}, protocol.Position{}, false
}

func displayedNavigationRange(view documentView, id string) (protocol.Range, bool) {
	for _, site := range view.sites {
		if site.Site.ID == id {
			return site.Range, true
		}
	}
	return protocol.Range{}, false
}
