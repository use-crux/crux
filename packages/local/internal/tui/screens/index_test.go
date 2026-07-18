package screens

import (
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestIndexKeybindsDescribeOnlyHandledActions(t *testing.T) {
	index := NewIndex()
	bindings := index.Keybinds()

	for _, binding := range bindings {
		switch binding.Key {
		case "j/k", "e":
		default:
			t.Errorf("Index advertised unhandled key %q (%s)", binding.Key, binding.Label)
		}
	}
}

func TestIndexKeybindsOmitExportWithoutSelection(t *testing.T) {
	index := NewIndex()

	for _, binding := range index.Keybinds() {
		if binding.Key == "e" {
			t.Fatal("Index advertised export without a selected definition")
		}
	}
}

func sampleIndex() api.IndexData {
	return api.IndexData{
		Definitions: []api.ProjectDefinition{
			{
				ID:       "prompt:writer.prompt",
				Kind:     "prompt",
				Name:     "writer.prompt",
				Fidelity: "resolved",
			},
			{
				ID:       "agent:docs_agent",
				Kind:     "agent",
				Name:     "docs_agent",
				Fidelity: "resolved",
				// No Inspect block — should render with no signal.
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

	c.Update(tea.KeyPressMsg(tea.Key{Text: "j", Code: 'j'}), nil)
	if got := c.SelectedDefinitionID(); got != "agent:docs_agent" {
		t.Errorf("after j = %q, want %q", got, "agent:docs_agent")
	}

	c.Update(tea.KeyPressMsg(tea.Key{Text: "k", Code: 'k'}), nil)
	if got := c.SelectedDefinitionID(); got != "prompt:writer.prompt" {
		t.Errorf("after k = %q, want %q", got, "prompt:writer.prompt")
	}
}

// TestIndexChangedDefinitionsExposed asserts the screen surfaces a
// list of "changed since baseline" definitions for the workbench to
// build cross-screen affected-marker sets from. Per the backend
// handoff: TUI must NOT walk relations — it consumes the
// `ChangedSinceBaseline` flag the Go service supplies.
func TestIndexBreadcrumbUsesIndexRoot(t *testing.T) {
	c := NewIndex()
	c.loaded = true
	c.index = sampleIndex()

	path, _ := c.Breadcrumb()
	if len(path) == 0 || path[0] == "legacy" {
		t.Errorf("breadcrumb path starts wrong: %v", path)
	}
	if path[0] != "index" {
		t.Errorf("breadcrumb[0] = %q, want %q", path[0], "index")
	}
}

// TestIndexViewShowsChangedChip asserts the rendered list row for a
// definition with ChangedSinceBaseline=true contains a "changed"
// marker. Subtle but present per the backend handoff.
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

	cmd := c.Update(tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}
