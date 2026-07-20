package screens

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestIndexAcceptedRefreshPreservesScrolledRoutedDefinitionAnchor(t *testing.T) {
	definition := routedSourceDefinition("const version = 'initial'")
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{definition}})
	index.Resize(Size{Width: 100, Height: 18})
	index.Focus("definition", definition.ID)

	initialAnchor := index.CaptureLocation().Anchors["detail"]
	index.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	scrolled := index.CaptureLocation()
	if scrolled.Anchors["detail"] == initialAnchor {
		t.Fatalf("page down retained initial source anchor %q", initialAnchor)
	}

	refreshed := routedSourceDefinition("const version = 'refreshed-current-data'")
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "agent:before", Kind: "agent", Name: "before", Fidelity: "resolved"},
		refreshed,
	}})
	got := index.CaptureLocation()

	if got.SelectedIDs["definition"] != definition.ID || got.FocusedPane != "detail" {
		t.Fatalf("refreshed route identity = %#v, want exact definition with detail focus", got)
	}
	if got.Anchors["detail"] != scrolled.Anchors["detail"] {
		t.Fatalf("accepted refresh snapped detail anchor from %q to %q", scrolled.Anchors["detail"], got.Anchors["detail"])
	}
	selected, _, ok := index.definitions.Selected()
	if !ok || selected.SourceSnippet == nil || !strings.Contains(selected.SourceSnippet.Source, "refreshed-current-data") {
		t.Fatal("accepted refresh preserved stale routed definition content")
	}
}

func routedSourceDefinition(snippetFirstLine string) api.ProjectDefinition {
	column := 9
	return api.ProjectDefinition{
		ID:       "agent:routed-source",
		Kind:     "agent",
		Name:     "Routed source",
		Fidelity: "resolved",
		Source: &api.SourceLoc{
			File: "src/agents/routed.ts", Line: 42, Column: &column, Function: "createRoutedAgent",
		},
		SourceSnippet: &api.SourceSnippet{
			Source:   snippetFirstLine + "\n" + strings.Repeat("const stable = true\n", 40),
			Language: "typescript",
			Range:    api.SourceRange{File: "src/agents/routed.ts", StartLine: 42},
		},
	}
}
