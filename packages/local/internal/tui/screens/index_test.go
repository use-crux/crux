package screens

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func sampleIndex() api.IndexData {
	changed := true
	return api.IndexData{
		Definitions: []api.ProjectDefinition{
			{
				ID:       "prompt:writer.prompt",
				Kind:     "prompt",
				Name:     "writer.prompt",
				Fidelity: "resolved",
				Quality: &api.IndexQuality{
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

// TestIndexCursorCyclesDefinitions asserts j/k cycle through the
// definitions list with the cursor exposing the selected def id.
func TestIndexCursorCyclesDefinitions(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

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

// TestIndexChangedDefinitionsExposed asserts the screen surfaces a
// list of "changed since baseline" definitions for the workbench to
// build cross-screen affected-marker sets from. Per the backend
// handoff: TUI must NOT walk relations — it consumes the
// `ChangedSinceBaseline` flag the Go service supplies.
func TestIndexChangedDefinitionsExposed(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

	affectedSuites := c.AffectedSuiteIDs()
	if _, ok := affectedSuites["regression"]; !ok {
		t.Errorf("AffectedSuiteIDs missing \"regression\"; got %v", affectedSuites)
	}
	affectedEvals := c.AffectedEvalIDs()
	if _, ok := affectedEvals["writer-eval"]; !ok {
		t.Errorf("AffectedEvalIDs missing \"writer-eval\"; got %v", affectedEvals)
	}
}

// TestIndexAffectedNilQualityIsNoSignal asserts a definition with
// no Quality field contributes nothing to the affected sets — per
// the backend handoff: missing Quality renders as no signal, not an
// error.
func TestIndexAffectedNilQualityIsNoSignal(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = api.IndexData{
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

// TestIndexBreadcrumbDropsQualityPrefix asserts the breadcrumb path
// is `index [/ {def-id}]` — never starts with `quality`.
func TestIndexBreadcrumbDropsQualityPrefix(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

	path, _ := c.Breadcrumb()
	if len(path) == 0 || path[0] == "quality" {
		t.Errorf("breadcrumb path starts wrong: %v", path)
	}
	if path[0] != "index" {
		t.Errorf("breadcrumb[0] = %q, want %q", path[0], "index")
	}
}

// TestIndexViewShowsChangedChip asserts the rendered list row for a
// definition with ChangedSinceBaseline=true contains a "changed"
// marker. Subtle but present per the backend handoff.
func TestIndexViewShowsChangedChip(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

	out := c.View(Size{Width: 160, Height: 40})
	if !strings.Contains(out, "changed") {
		t.Errorf("index View() does not contain `changed` chip for a ChangedSinceBaseline definition")
	}
}

func TestIndexViewShowsBackendLintFindings(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()
	c.index.LintFindings = []api.IndexLintFinding{
		{
			ID:                   "lint:tool:search",
			Severity:             "warning",
			RuleID:               "tool.missing_input_schema",
			Title:                "Tool has no input schema",
			Rationale:            "Typed inputs let users inspect model intent before execution.",
			DocsURL:              "/docs/reference/crux-core/index-lints/tool-missing-input-schema",
			RelatedDefinitionIDs: []string{"agent:docs_agent"},
		},
	}
	c.cursor = 1

	out := c.View(Size{Width: 160, Height: 40})
	for _, want := range []string{"lint 1", "LINT", "tool.missing_input_schema", "Typed inputs"} {
		if !strings.Contains(out, want) {
			t.Fatalf("index View() missing %q in:\n%s", want, out)
		}
	}
}

// TestIndexExportEmitsCmd asserts `e` returns a non-nil cmd that
// exports the focused definition as JSON.
func TestIndexExportEmitsCmd(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

	cmd := c.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'e'}}, nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}
