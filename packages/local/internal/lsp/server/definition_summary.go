package server

import (
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type definitionSummary struct {
	Definition        documentDefinition
	FindingCount      int
	IncomingRelations int
	OutgoingRelations int
}

// HoverAt returns findings and an optional definition summary from one
// coherent displayed-view snapshot.
func (p *Publisher) HoverAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) ([]displayedFinding, *definitionSummary) {
	view, scopeFindings, ok := p.definitionSummaryView(uri)
	if !ok {
		return nil, nil
	}
	findings := displayedFindingsAt(view, position)
	for _, summary := range summarizeDefinitions(view, scopeFindings, view.relationCounts) {
		if rangeContainsPosition(summary.Definition.Range, position) {
			return findings, &summary
		}
	}
	return findings, nil
}

// HoverAt resolves one coherent hover view in the most-specific configured
// workspace scope containing uri.
func (w *workspaceRuntime) HoverAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) ([]displayedFinding, *definitionSummary) {
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return nil, nil
	}
	return publisher.HoverAt(uri, position)
}

// DefinitionSummaryAt returns the displayed definition and its current
// finding/relation counts at a document position.
func (p *Publisher) DefinitionSummaryAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) (definitionSummary, bool) {
	view, scopeFindings, ok := p.definitionSummaryView(uri)
	if !ok {
		return definitionSummary{}, false
	}
	for _, summary := range summarizeDefinitions(view, scopeFindings, view.relationCounts) {
		if rangeContainsPosition(summary.Definition.Range, position) {
			return summary, true
		}
	}
	return definitionSummary{}, false
}

// DefinitionSummaryAt resolves a definition summary in the most-specific
// configured workspace scope containing uri.
func (w *workspaceRuntime) DefinitionSummaryAt(
	uri protocol.DocumentURI,
	position protocol.Position,
) (definitionSummary, bool) {
	publisher := w.navigationPublisher(uri)
	if publisher == nil {
		return definitionSummary{}, false
	}
	return publisher.DefinitionSummaryAt(uri, position)
}

// DefinitionSummariesIn returns displayed definitions with counts computed
// from the current displayed findings and retained scope relations.
func (p *Publisher) DefinitionSummariesIn(uri protocol.DocumentURI) []definitionSummary {
	view, scopeFindings, ok := p.definitionSummaryView(uri)
	if !ok {
		return nil
	}
	return summarizeDefinitions(view, scopeFindings, view.relationCounts)
}

func summarizeDefinitions(
	view documentView,
	scopeFindings map[string]api.IndexLintFinding,
	relationCounts map[string]definitionRelationCount,
) []definitionSummary {
	result := make([]definitionSummary, len(view.definitions))
	for index, definition := range view.definitions {
		result[index].Definition = definition
		seenFindings := make(map[string]struct{})
		for findingID, finding := range scopeFindings {
			if finding.PrimaryDefinitionID == definition.Definition.ID ||
				containsString(finding.AffectedDefinitionIDs, definition.Definition.ID) {
				seenFindings[findingID] = struct{}{}
			}
		}
		for _, diagnostic := range view.diagnostics {
			findingID := diagnosticFindingID(diagnostic)
			_, ok := view.findings[findingID]
			if !ok || !rangeContainsPosition(definition.Range, diagnostic.Range.Start) {
				continue
			}
			seenFindings[findingID] = struct{}{}
		}
		result[index].FindingCount = len(seenFindings)
		counts := relationCounts[definition.Definition.ID]
		result[index].IncomingRelations = counts.Incoming
		result[index].OutgoingRelations = counts.Outgoing
	}
	return result
}

func (p *Publisher) definitionSummaryView(
	uri protocol.DocumentURI,
) (documentView, map[string]api.IndexLintFinding, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed {
		return documentView{}, nil, false
	}
	return p.documentViewLocked(uri), p.displayedScopeFindingsLocked(), true
}

func (p *Publisher) documentViewLocked(uri protocol.DocumentURI) documentView {
	document := p.documents[uri]
	if document != nil && document.open {
		return detachDocumentView(document.view)
	}
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	var diagnostics []protocol.Diagnostic
	var findings map[string]api.IndexLintFinding
	if document != nil {
		diagnostics = cloneDiagnostics(document.view.diagnostics)
		findings = cloneFindingMap(document.view.findings)
	}
	return detachDocumentView(p.currentDocumentView(uri, publication, diagnostics, findings))
}

func (p *Publisher) displayedScopeFindingsLocked() map[string]api.IndexLintFinding {
	ordered := make([]string, 0, len(p.documents))
	for uri := range p.documents {
		ordered = append(ordered, string(uri))
	}
	sort.Strings(ordered)
	result := make(map[string]api.IndexLintFinding)
	for _, value := range ordered {
		for id, finding := range p.documents[protocol.DocumentURI(value)].view.findings {
			if _, exists := result[id]; !exists {
				result[id] = finding
			}
		}
	}
	return result
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
