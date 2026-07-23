package server

import (
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func TestPublisherDerivesCompositeFromOneCapturedStorePublication(t *testing.T) {
	store, publisher, _, uri, file := newViewPublisher(t)
	store.ApplySnapshot("scope", publisherPublicationFixture("a", file, 1))
	captured := store.PublicationSnapshot("scope")
	store.ApplySnapshot("scope", publisherPublicationFixture("b", file, 8))

	diagnostics, findings := publisher.currentDiagnostics(captured)
	currentDiagnostics := diagnostics[uri]
	view := publisher.currentDocumentView(uri, captured, currentDiagnostics, findingsForDiagnostics(currentDiagnostics, findings))
	if len(view.diagnostics) != 1 || diagnosticFindingID(view.diagnostics[0]) != "finding:a" ||
		len(view.definitions) != 1 || view.definitions[0].Definition.ID != "a" ||
		len(view.sites) != 1 || view.sites[0].Site.TargetDefinitionID != "a" {
		t.Fatalf("captured composite mixed Store publications: %#v", view)
	}
	if view.definitions[0].Range.Start != (protocol.Position{Line: 0}) {
		t.Fatalf("captured definition range = %#v, want first line", view.definitions[0].Range)
	}
}

func publisherPublicationFixture(id, file string, line int) readmodel.Snapshot {
	column := 1
	return readmodel.Snapshot{
		Findings: []api.IndexLintFinding{{
			ID: "finding:" + id, RuleID: "test." + id, Severity: "warning", Title: id,
			Profiles: []string{"recommended"}, Source: &api.SourceLoc{File: file, Line: line, Column: &column},
		}},
		Definitions: []api.ProjectDefinition{{
			ID: id, SourceSnippet: &api.SourceSnippet{Range: api.SourceRange{File: file, StartLine: line}},
			SourceRefs: []api.ProjectSourceRef{{
				ID: "ref:" + id, Source: api.SourceLoc{File: file, Line: line, Column: &column},
			}},
		}},
	}
}
