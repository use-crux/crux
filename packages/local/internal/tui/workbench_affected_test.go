package tui

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/screens"
)

// TestWorkbenchPropagatesAffectedSuitesToSuites asserts that after
// the Catalog screen loads its data, the workbench's propagation
// step picks up the union of `AffectedSuiteIDs` across all
// ChangedSinceBaseline definitions and hands them to the Suites
// screen. Suites then renders an `affected` chip per row whose id is
// in the set. Per the backend handoff: TUI doesn't walk relations —
// it consumes the precomputed list.
func TestWorkbenchPropagatesAffectedSuitesToSuites(t *testing.T) {
	w := NewWorkbench(nil, nil, "http://localhost:4400")

	// Replace the live screens with our test instances so we can poke
	// the catalog data + observe the Suites side directly.
	cat := screens.NewCatalog()
	w.screens["catalog"] = cat
	suites := screens.NewDatasets()
	w.screens["suites"] = suites

	changed := true
	cat.SetCatalogForTest(api.CatalogData{
		Definitions: []api.ProjectDefinition{
			{
				ID:   "prompt:writer.prompt",
				Kind: "prompt",
				Name: "writer.prompt",
				Quality: &api.CatalogQuality{
					ChangedSinceBaseline: &changed,
					AffectedSuiteIDs:     []string{"regression", "rfp-gold"},
				},
			},
		},
	})

	// A no-op tea.Msg routed through Update triggers post-step
	// propagation. (Workbench runs propagation on every Update so
	// catalogLoadedMsg events reaching the Catalog screen flow into
	// Suites without an explicit subscription.)
	w.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}})

	got := suites.AffectedSuiteIDs()
	if _, ok := got["regression"]; !ok {
		t.Errorf("Suites.AffectedSuiteIDs() missing \"regression\"; got %v", got)
	}
	if _, ok := got["rfp-gold"]; !ok {
		t.Errorf("Suites.AffectedSuiteIDs() missing \"rfp-gold\"; got %v", got)
	}
}
