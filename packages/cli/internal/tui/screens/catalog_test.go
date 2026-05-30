package screens

import (
	"strings"
	"testing"

	"github.com/anthropics/crux-cli/internal/api"
	tea "github.com/charmbracelet/bubbletea"
)

func sampleCatalog() api.CatalogData {
	changed := true
	return api.CatalogData{
		Definitions: []api.ProjectDefinition{
			{
				ID:       "prompt:writer.prompt",
				Kind:     "prompt",
				Name:     "writer.prompt",
				Fidelity: "resolved",
				Quality: &api.CatalogQuality{
					AffectedEvalIDs:      []string{"writer-eval"},
					AffectedSuiteIDs:     []string{"regression"},
					ChangedSinceBaseline: &changed,
					CurrentFingerprint:   "fp-new-1234",
					BaselineFingerprint:  "fp-old-9876",
				},
			},
			{
				ID:       "agent:docs_agent",
				Kind:     "agent",
				Name:     "docs_agent",
				Fidelity: "resolved",
				// No Quality block — should render with no signal.
			},
			{
				ID:       "context:fragment.broken",
				Kind:     "context",
				Name:     "fragment.broken",
				Fidelity: "error",
			},
		},
	}
}

// TestCatalogCursorCyclesDefinitions asserts j/k cycle through the
// definitions list with the cursor exposing the selected def id.
func TestCatalogCursorCyclesDefinitions(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()

	if got := c.SelectedDefinitionID(); got != "prompt:writer.prompt" {
		t.Fatalf("initial = %q", got)
	}

	c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'j'}}, nil)
	if got := c.SelectedDefinitionID(); got != "agent:docs_agent" {
		t.Errorf("after j = %q, want %q", got, "agent:docs_agent")
	}

	c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'k'}}, nil)
	if got := c.SelectedDefinitionID(); got != "prompt:writer.prompt" {
		t.Errorf("after k = %q, want %q", got, "prompt:writer.prompt")
	}
}

// TestCatalogChangedDefinitionsExposed asserts the screen surfaces a
// list of "changed since baseline" definitions for the workbench to
// build cross-screen affected-marker sets from. Per the backend
// handoff: TUI must NOT walk relations — it consumes the
// `ChangedSinceBaseline` flag the Go service supplies.
func TestCatalogChangedDefinitionsExposed(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()

	affectedSuites := c.AffectedSuiteIDs()
	if _, ok := affectedSuites["regression"]; !ok {
		t.Errorf("AffectedSuiteIDs missing \"regression\"; got %v", affectedSuites)
	}
	affectedEvals := c.AffectedEvalIDs()
	if _, ok := affectedEvals["writer-eval"]; !ok {
		t.Errorf("AffectedEvalIDs missing \"writer-eval\"; got %v", affectedEvals)
	}
}

// TestCatalogAffectedNilQualityIsNoSignal asserts a definition with
// no Quality field contributes nothing to the affected sets — per
// the backend handoff: missing Quality renders as no signal, not an
// error.
func TestCatalogAffectedNilQualityIsNoSignal(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = api.CatalogData{
		Definitions: []api.ProjectDefinition{
			{ID: "agent:no-quality", Kind: "agent", Name: "no-quality"},
		},
	}
	if got := c.AffectedSuiteIDs(); len(got) != 0 {
		t.Errorf("AffectedSuiteIDs from quality-less def = %v, want empty", got)
	}
	if got := c.AffectedEvalIDs(); len(got) != 0 {
		t.Errorf("AffectedEvalIDs from quality-less def = %v, want empty", got)
	}
}

// TestCatalogBreadcrumbDropsQualityPrefix asserts the breadcrumb path
// is `catalog [/ {def-id}]` — never starts with `quality`.
func TestCatalogBreadcrumbDropsQualityPrefix(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()

	path, _ := c.Breadcrumb()
	if len(path) == 0 || path[0] == "quality" {
		t.Errorf("breadcrumb path starts wrong: %v", path)
	}
	if path[0] != "catalog" {
		t.Errorf("breadcrumb[0] = %q, want %q", path[0], "catalog")
	}
}

// TestCatalogViewShowsChangedChip asserts the rendered list row for a
// definition with ChangedSinceBaseline=true contains a "changed"
// marker. Subtle but present per the backend handoff.
func TestCatalogViewShowsChangedChip(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()

	out := c.View(Size{Width: 160, Height: 40})
	if !strings.Contains(out, "changed") {
		t.Errorf("catalog View() does not contain `changed` chip for a ChangedSinceBaseline definition")
	}
}

func TestCatalogViewShowsBackendLintFindings(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()
	c.catalog.LintFindings = []api.CatalogLintFinding{
		{
			ID:                   "lint:tool:search",
			Severity:             "warning",
			RuleID:               "tool.missing_input_schema",
			Title:                "Tool has no input schema",
			Rationale:            "Typed inputs let users inspect model intent before execution.",
			DocsURL:              "/docs/reference/crux-core/catalog-lints/tool-missing-input-schema",
			RelatedDefinitionIDs: []string{"agent:docs_agent"},
		},
	}
	c.cursor = 1

	out := c.View(Size{Width: 160, Height: 40})
	for _, want := range []string{"lint 1", "LINT", "tool.missing_input_schema", "Typed inputs"} {
		if !strings.Contains(out, want) {
			t.Fatalf("catalog View() missing %q in:\n%s", want, out)
		}
	}
}

// TestCatalogExportEmitsCmd asserts `e` returns a non-nil cmd that
// exports the focused definition as JSON.
func TestCatalogExportEmitsCmd(t *testing.T) {
	c := NewCatalog()
	c.loaded = true
	c.catalog = sampleCatalog()

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}
