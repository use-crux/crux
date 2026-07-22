package server

import (
	"crypto/sha256"
	"encoding/json"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

type publishedDocument struct {
	view         documentView
	hash         [sha256.Size]byte
	hasPublished bool
	open         bool
	version      int
	hasVersion   bool
	dirty        bool
	held         *documentView
}

type displayedFinding struct {
	Diagnostic protocol.Diagnostic
	Finding    api.IndexLintFinding
}

func (p *Publisher) publishLocked(force protocol.DocumentURI, authoritative bool) {
	publication := p.options.Store.PublicationSnapshot(p.options.ScopeID)
	diagnostics, findings := p.currentDiagnostics(publication)
	uris := make(map[protocol.DocumentURI]struct{}, len(diagnostics)+len(p.documents)+1)
	for uri := range diagnostics {
		uris[uri] = struct{}{}
	}
	for uri := range p.documents {
		uris[uri] = struct{}{}
	}
	if force != "" {
		uris[force] = struct{}{}
	}
	ordered := make([]string, 0, len(uris))
	for uri := range uris {
		ordered = append(ordered, string(uri))
	}
	sort.Strings(ordered)
	for _, value := range ordered {
		uri := protocol.DocumentURI(value)
		current := diagnostics[uri]
		if current == nil {
			current = []protocol.Diagnostic{}
		}
		document := p.documentLocked(uri)
		currentFindings := findingsForDiagnostics(current, findings)
		view := documentView{diagnostics: current, findings: currentFindings}
		if document.open {
			view = p.currentDocumentView(uri, publication, current, currentFindings)
		}
		if authoritative && document.open && document.dirty && len(current) > 0 {
			held := cloneDocumentView(view)
			document.held = &held
			continue
		}
		if authoritative && document.open && document.dirty {
			held := cloneDocumentView(view)
			document.held = &held
			cleared := cloneDocumentView(document.view)
			cleared.diagnostics = []protocol.Diagnostic{}
			cleared.findings = nil
			p.setDisplayedLocked(uri, cleared, uri == force)
			continue
		}
		document.held = nil
		p.setDisplayedLocked(uri, view, uri == force)
	}
	p.options.OnPublish()
}

func (p *Publisher) setDisplayedLocked(
	uri protocol.DocumentURI,
	view documentView,
	force bool,
) {
	document := p.documentLocked(uri)
	diagnostics := view.diagnostics
	hash := diagnosticHash(diagnostics)
	if !force {
		if document.hasPublished && document.hash == hash {
			document.view = cloneDocumentView(view)
			return
		}
		if !document.hasPublished && len(diagnostics) == 0 {
			document.view = cloneDocumentView(view)
			document.view.diagnostics = []protocol.Diagnostic{}
			p.deleteDocumentIfIdleLocked(uri, document)
			return
		}
	}
	current := cloneDiagnostics(diagnostics)
	if current == nil {
		current = []protocol.Diagnostic{}
	}
	p.options.Notify(protocol.MethodPublishDiagnostics, protocol.PublishDiagnosticsParams{
		URI: uri, Diagnostics: current,
	})
	document.view = cloneDocumentView(view)
	document.view.diagnostics = current
	document.hash = hash
	document.hasPublished = len(current) > 0
	p.deleteDocumentIfIdleLocked(uri, document)
}

// DisplayedFindings returns the finding diagnostics visible at a document
// position. It reads only the publisher's coherent displayed view.
func (p *Publisher) DisplayedFindings(uri protocol.DocumentURI, position protocol.Position) []displayedFinding {
	p.mu.Lock()
	defer p.mu.Unlock()
	document := p.documents[uri]
	if p.closed || document == nil {
		return nil
	}
	return displayedFindingsAt(document.view, position)
}

func displayedFindingsAt(view documentView, position protocol.Position) []displayedFinding {
	result := make([]displayedFinding, 0)
	for _, diagnostic := range view.diagnostics {
		if !rangeContainsPosition(diagnostic.Range, position) {
			continue
		}
		finding, ok := view.findings[diagnosticFindingID(diagnostic)]
		if !ok {
			continue
		}
		cloned := cloneDiagnostics([]protocol.Diagnostic{diagnostic})[0]
		result = append(result, displayedFinding{Diagnostic: cloned, Finding: finding})
	}
	return result
}

func (p *Publisher) documentLocked(uri protocol.DocumentURI) *publishedDocument {
	document := p.documents[uri]
	if document == nil {
		document = &publishedDocument{}
		p.documents[uri] = document
	}
	return document
}

func (p *Publisher) deleteDocumentIfIdleLocked(uri protocol.DocumentURI, document *publishedDocument) {
	if !document.hasPublished && !document.open && document.held == nil {
		delete(p.documents, uri)
	}
}

func diagnosticHash(diagnostics []protocol.Diagnostic) [sha256.Size]byte {
	payload, _ := json.Marshal(diagnostics)
	return sha256.Sum256(payload)
}

func findingsForDiagnostics(
	diagnostics []protocol.Diagnostic,
	findings map[string]api.IndexLintFinding,
) map[string]api.IndexLintFinding {
	result := make(map[string]api.IndexLintFinding, len(diagnostics))
	for _, diagnostic := range diagnostics {
		id := diagnosticFindingID(diagnostic)
		if finding, ok := findings[id]; ok {
			result[id] = finding
		}
	}
	return result
}

func diagnosticFindingID(diagnostic protocol.Diagnostic) string {
	var identity struct {
		ID string `json:"id"`
	}
	if json.Unmarshal(diagnostic.Data, &identity) != nil {
		return ""
	}
	return identity.ID
}

func cloneFindingMap(findings map[string]api.IndexLintFinding) map[string]api.IndexLintFinding {
	if len(findings) == 0 {
		return nil
	}
	cloned := make(map[string]api.IndexLintFinding, len(findings))
	for id, finding := range findings {
		cloned[id] = finding
	}
	return cloned
}

func rangeContainsPosition(diagnosticRange protocol.Range, position protocol.Position) bool {
	if diagnosticRange.Start == diagnosticRange.End {
		return position == diagnosticRange.Start
	}
	return comparePosition(diagnosticRange.Start, position) <= 0 &&
		comparePosition(position, diagnosticRange.End) < 0
}
