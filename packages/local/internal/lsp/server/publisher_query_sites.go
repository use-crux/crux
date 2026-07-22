package server

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// SiteAt returns the nearest navigable site displayed on the requested line.
// Columnless sites match their complete line and serve as a fallback when no
// positioned site begins at or before the cursor.
func (p *Publisher) SiteAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) (documentNavigationSite, bool) {
	view, open := p.openDocumentView(uri)
	if !open {
		publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
		view = p.currentDocumentView(uri, publication, nil, nil)
	}
	return siteAt(view.sites, position)
}

func siteAt(sites []documentNavigationSite, position protocol.Position) (documentNavigationSite, bool) {
	var fallback documentNavigationSite
	var hasFallback bool
	var best documentNavigationSite
	var hasBest bool
	for _, site := range sites {
		if site.Range.Start.Line != position.Line {
			continue
		}
		if site.Site.Source.Column == nil {
			if !hasFallback || displayedNavigationSiteLess(site, fallback) {
				fallback, hasFallback = site, true
			}
			continue
		}
		if position.Character < site.Range.Start.Character {
			continue
		}
		if !hasBest || site.Range.Start.Character > best.Range.Start.Character ||
			(site.Range.Start.Character == best.Range.Start.Character && displayedNavigationSiteLess(site, best)) {
			best, hasBest = site, true
		}
	}
	if hasBest {
		return best, true
	}
	return fallback, hasFallback
}

func displayedNavigationSiteLess(left, right documentNavigationSite) bool {
	leftColumn, rightColumn := uint32(0), uint32(0)
	if left.Site.Source.Column != nil {
		leftColumn = left.Range.Start.Character
	}
	if right.Site.Source.Column != nil {
		rightColumn = right.Range.Start.Character
	}
	switch {
	case left.Site.Source.File != right.Site.Source.File:
		return left.Site.Source.File < right.Site.Source.File
	case left.Range.Start.Line != right.Range.Start.Line:
		return left.Range.Start.Line < right.Range.Start.Line
	case leftColumn != rightColumn:
		return leftColumn < rightColumn
	case left.Site.ID != right.Site.ID:
		return left.Site.ID < right.Site.ID
	case left.Site.TargetDefinitionID != right.Site.TargetDefinitionID:
		return left.Site.TargetDefinitionID < right.Site.TargetDefinitionID
	case left.Site.Role != right.Site.Role:
		return left.Site.Role < right.Site.Role
	default:
		return left.Site.Source.Function < right.Site.Source.Function
	}
}

// ReferencesTo returns every displayed relation and source-ref site targeting
// a definition. Open documents replace Store rows for their URI, including
// while a newer authoritative view is held behind unsaved edits.
func (p *Publisher) ReferencesTo(definitionID string) []documentNavigationSite {
	open := p.openDocumentViews()
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	result := make([]documentNavigationSite, 0)
	for _, sites := range publication.SitesByFile {
		for _, site := range sites {
			uri, range_ := p.mapper.MapSourceLoc(site.Source)
			if _, substituted := open[uri]; substituted || site.TargetDefinitionID != definitionID {
				continue
			}
			result = append(result, documentNavigationSite{Site: site, Range: range_})
		}
	}
	for _, view := range open {
		for _, site := range view.sites {
			if site.Site.TargetDefinitionID == definitionID {
				result = append(result, site)
			}
		}
	}
	sort.Slice(result, func(left, right int) bool {
		return displayedNavigationSiteLess(result[left], result[right])
	})
	return result
}
