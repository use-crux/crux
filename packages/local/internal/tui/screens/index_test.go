package screens

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestIndexKeybindsDescribeOnlyHandledActions(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(sampleIndex())
	bindings := index.Keybinds()

	for _, binding := range bindings {
		switch binding.Key {
		case "j/↓", "k/↑", "pgdn/ctrl+d", "pgup/ctrl+u", "home", "end", "l/→/tab", "e":
		default:
			t.Errorf("Index advertised unhandled key %q (%s)", binding.Key, binding.Label)
		}
	}
}

func TestIndexKeybindsOmitExportWithoutSelection(t *testing.T) {
	index := NewIndex()
	if bindings := index.Keybinds(); len(bindings) != 0 {
		t.Fatalf("empty Index advertised no-op actions: %+v", bindings)
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
	c.SetIndexForTest(sampleIndex())

	if got := c.SelectedDefinitionID(); got != "prompt:writer.prompt" {
		t.Fatalf("initial = %q", got)
	}

	c.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "j", Code: 'j'}), nil)
	if got := c.SelectedDefinitionID(); got != "agent:docs_agent" {
		t.Errorf("after j = %q, want %q", got, "agent:docs_agent")
	}

	c.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "k", Code: 'k'}), nil)
	if got := c.SelectedDefinitionID(); got != "prompt:writer.prompt" {
		t.Errorf("after k = %q, want %q", got, "prompt:writer.prompt")
	}
}

func TestIndexFocusSelectsExactDefinitionWhenDisplayNamesAreDuplicate(t *testing.T) {
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "agent:shared-first", Kind: "agent", Name: "shared", Fidelity: "resolved"},
		{ID: "agent:shared-second", Kind: "agent", Name: "shared", Fidelity: "resolved"},
	}})

	index.Focus("definition", "agent:shared-second")

	if got := index.SelectedDefinitionID(); got != "agent:shared-second" {
		t.Fatalf("exact routed selection = %q, want second duplicate-name definition", got)
	}
}

func TestIndexFocusShowsExactUnavailableReferenceWithoutSelectingSubstitute(t *testing.T) {
	index := NewIndex()
	index.Focus("definition", "agent:missing-shared")
	index.SetIndexForTest(api.IndexData{Definitions: []api.ProjectDefinition{
		{ID: "agent:available-shared", Kind: "agent", Name: "shared", Fidelity: "resolved"},
	}})
	index.Resize(Size{Width: 70, Height: 21})

	if got := index.SelectedDefinitionID(); got != "" {
		t.Fatalf("missing exact route selected substitute %q", got)
	}
	view := stripANSI(index.View(Size{}))
	for _, want := range []string{"agent:missing-shared", "not in current index"} {
		if !strings.Contains(view, want) {
			t.Fatalf("missing exact route omitted %q:\n%s", want, view)
		}
	}
	if strings.Contains(view, "agent:available-shared") {
		t.Fatalf("missing exact route rendered substitute selection:\n%s", view)
	}
}

// TestIndexChangedDefinitionsExposed asserts the screen surfaces a
// list of "changed since baseline" definitions for the workbench to
// build cross-screen affected-marker sets from. Per the backend
// handoff: TUI must NOT walk relations — it consumes the
// `ChangedSinceBaseline` flag the Go service supplies.
func TestIndexBreadcrumbUsesIndexRoot(t *testing.T) {
	c := NewIndex()
	c.SetIndexForTest(sampleIndex())

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
	data := sampleIndex()
	data.LintFindings = []api.IndexLintFinding{
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
	c.SetIndexForTest(data)
	c.definitions.Select("agent:docs_agent")
	c.Resize(Size{Width: 160, Height: 40})

	out := c.View(Size{Width: 160, Height: 40})
	for _, want := range []string{"lint 1", "LINT", "tool.missing_input_schema", "Typed inputs"} {
		if !strings.Contains(out, want) {
			t.Fatalf("index View() missing %q in:\n%s", want, out)
		}
	}
}

func TestIndexViewOmitsSuppressedFindingsFromBadgesAndLists(t *testing.T) {
	c := NewIndex()
	data := sampleIndex()
	data.LintFindings = []api.IndexLintFinding{
		{ID: "active", RuleID: "active.rule", PrimaryDefinitionID: "agent:docs_agent"},
		{ID: "suppressed", RuleID: "suppressed.rule", PrimaryDefinitionID: "agent:docs_agent", Suppressed: true},
	}
	c.SetIndexForTest(data)
	c.definitions.Select("agent:docs_agent")
	c.Resize(Size{Width: 160, Height: 40})

	findings := c.lintFindingsForDefinition("agent:docs_agent")
	if len(findings) != 1 || findings[0].ID != "active" {
		t.Fatalf("lint findings = %+v, want active-only list", findings)
	}
	out := c.View(Size{Width: 160, Height: 40})
	if !strings.Contains(out, "lint 1") || strings.Contains(out, "suppressed.rule") {
		t.Fatalf("index View() = %q, want active-only badge and detail", out)
	}
}

// TestIndexExportEmitsCmd asserts `e` returns a non-nil cmd that
// exports the focused definition as JSON.
func TestIndexExportEmitsCmd(t *testing.T) {
	c := NewIndex()
	c.SetIndexForTest(sampleIndex())

	cmd := c.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "e", Code: 'e'}), nil)
	if cmd == nil {
		t.Error("pressing `e` returned nil; expected export cmd")
	}
}

func TestIndexStructuredDetailScrollsWrappedSource(t *testing.T) {
	sourceLines := make([]string, 30)
	for i := range sourceLines {
		sourceLines[i] = fmt.Sprintf("snippet-line-%02d const value = %q", i+1, strings.Repeat("wrapped source ", 5))
	}
	data := api.IndexData{
		Definitions: []api.ProjectDefinition{
			{
				ID:          "prompt:scrollable",
				Kind:        "prompt",
				Name:        "scrollable",
				Description: "A definition whose authored source remains readable without truncation.",
				Fidelity:    "resolved",
				Source:      &api.SourceLoc{File: "src/prompts/scrollable.ts", Line: 12},
				SourceSnippet: &api.SourceSnippet{
					Source:   strings.Join(sourceLines, "\n"),
					Language: "typescript",
					Range:    api.SourceRange{File: "src/prompts/scrollable.ts", StartLine: 12},
				},
			},
		},
	}
	index := NewIndex()
	index.SetIndexForTest(data)
	index.Resize(Size{Width: 100, Height: 18})

	initial := stripANSI(index.View(Size{Width: 100, Height: 18}))
	if !strings.Contains(initial, "SOURCE SNIPPET") || !strings.Contains(initial, "snippet-line-01") {
		t.Fatalf("structured detail omitted the beginning of authored source:\n%s", initial)
	}
	if strings.Contains(initial, "snippet-line-30") {
		t.Fatalf("long source unexpectedly fit without scrolling:\n%s", initial)
	}

	index.Update(testContext, tea.KeyPressMsg{Text: "l", Code: 'l'}, nil)
	for range 8 {
		index.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	}
	scrolled := stripANSI(index.View(Size{Width: 100, Height: 18}))
	if !strings.Contains(scrolled, "snippet-line-30") {
		t.Fatalf("detail page scrolling never revealed the source tail:\n%s", scrolled)
	}
	if initial == scrolled {
		t.Fatal("detail page scrolling left the viewport unchanged")
	}
}

func TestIndexMouseWheelMovesOnlyFocusedPane(t *testing.T) {
	index := NewIndex()
	data := sampleIndex()
	data.Definitions[1].SourceSnippet = &api.SourceSnippet{
		Source: strings.Repeat("detail line\n", 40),
		Range:  api.SourceRange{File: "src/prompt.ts", StartLine: 1},
	}
	index.SetIndexForTest(data)
	index.Resize(Size{Width: 100, Height: 18})

	index.Update(testContext, tea.MouseWheelMsg{Button: tea.MouseWheelDown}, nil)
	if got := index.SelectedDefinitionID(); got != "agent:docs_agent" {
		t.Fatalf("definition wheel selection = %q, want second definition", got)
	}
	index.Update(testContext, tea.KeyPressMsg{Text: "l", Code: 'l'}, nil)
	selected := index.SelectedDefinitionID()
	before := index.detail.Position().Offset
	index.Update(testContext, tea.MouseWheelMsg{Button: tea.MouseWheelDown}, nil)
	if got := index.SelectedDefinitionID(); got != selected {
		t.Fatalf("detail wheel changed definition from %q to %q", selected, got)
	}
	if got := index.detail.Position().Offset; got <= before {
		t.Fatalf("detail wheel offset = %d, want > %d", got, before)
	}
}

func TestIndexSanitizesAuthoredTerminalControlsAndStaysBounded(t *testing.T) {
	const hostile = "\x1b]8;;https://evil.invalid\x07linked\x1b]8;;\x07\x00\r\x1b[31mred\x1b[0m"
	definition := api.ProjectDefinition{
		ID:          "prompt:" + hostile + "\ninjected-row",
		Kind:        "prompt",
		Name:        hostile,
		Description: hostile,
		Fidelity:    "partial" + hostile,
		Source:      &api.SourceLoc{File: "src/" + hostile + ".ts", Line: 1},
		SourceSnippet: &api.SourceSnippet{
			Source: "\tconst safe = true\n" + hostile + "\nlast line",
			Range:  api.SourceRange{File: "src/" + hostile + ".ts", StartLine: 1},
		},
		SourceRefs: []api.ProjectSourceRef{{
			ID: hostile, Role: hostile, Symbol: hostile, Fidelity: hostile,
			Source:  api.SourceLoc{File: hostile, Line: 2},
			Snippet: &api.SourceSnippet{Source: hostile, Range: api.SourceRange{File: hostile, StartLine: 2}},
		}},
	}
	data := api.IndexData{
		Definitions:  []api.ProjectDefinition{definition},
		LintFindings: []api.IndexLintFinding{{PrimaryDefinitionID: definition.ID, RuleID: hostile, Severity: hostile, Title: hostile, Message: hostile, Rationale: hostile}},
		Relations:    []api.ProjectRelation{{Type: hostile, From: definition.ID, To: hostile, Fidelity: hostile}},
		Diagnostics:  []api.IndexDiagnostic{{Code: hostile, Severity: hostile, Message: hostile, SuggestedFix: hostile, RelatedDefinitionIDs: []string{definition.ID}}},
	}
	for _, forbidden := range []string{"https://evil.invalid", "\x00", "\x07", "\r", "\t"} {
		if document := renderIndexDefinitionDocument(data, definition); strings.Contains(document, forbidden) {
			t.Fatalf("structured document retained unsafe payload %q:\n%q", forbidden, document)
		}
	}
	for _, size := range []Size{{Width: 70, Height: 24}, {Width: 100, Height: 30}, {Width: 160, Height: 45}} {
		index := NewIndex()
		index.SetIndexForTest(data)
		index.Resize(size)
		view := index.View(Size{})
		for _, forbidden := range []string{"https://evil.invalid", "\x00", "\x07", "\r", "\t"} {
			if strings.Contains(view, forbidden) {
				t.Fatalf("%dx%d Index rendered unsafe payload %q:\n%q", size.Width, size.Height, forbidden, view)
			}
		}
		lines := strings.Split(view, "\n")
		if len(lines) != size.Height {
			t.Fatalf("%dx%d hostile line count = %d, want %d", size.Width, size.Height, len(lines), size.Height)
		}
		for lineIndex, line := range lines {
			if width := lipgloss.Width(line); width != size.Width {
				t.Fatalf("%dx%d hostile line %d width = %d, want %d:\n%q", size.Width, size.Height, lineIndex+1, width, size.Width, line)
			}
		}
	}
}

func TestIndexStructuredDetailIncludesSourceReferenceIdentityAndSnippet(t *testing.T) {
	definition := api.ProjectDefinition{
		ID:       "agent:docs",
		Kind:     "agent",
		Name:     "docs",
		Fidelity: "resolved",
		SourceRefs: []api.ProjectSourceRef{{
			ID:       "source-ref:model-routing",
			Role:     "model",
			Symbol:   "fastModel",
			Fidelity: "resolved",
			Source:   api.SourceLoc{File: "src/models.ts", Line: 4},
			Snippet: &api.SourceSnippet{
				Source: "const fastModel = router({\n  fallback: safeModel,\n})",
				Range:  api.SourceRange{File: "src/models.ts", StartLine: 4},
			},
		}},
	}
	document := stripANSI(renderIndexDefinitionDocument(api.IndexData{}, definition))
	for _, want := range []string{"source-ref:model-routing", "snippet range", "const fastModel", "fallback: safeModel"} {
		if !strings.Contains(document, want) {
			t.Fatalf("structured source reference omitted %q:\n%s", want, document)
		}
	}
}

func TestIndexLocationRestoresExactDefinitionFocusAndAnchorsAgainstCurrentData(t *testing.T) {
	definitions := make([]api.ProjectDefinition, 24)
	for index := range definitions {
		definitions[index] = api.ProjectDefinition{
			ID:          fmt.Sprintf("prompt:%02d", index+1),
			Kind:        "prompt",
			Name:        fmt.Sprintf("definition %02d", index+1),
			Description: strings.Repeat(fmt.Sprintf("detail-%02d ", index+1), 20),
			Fidelity:    "resolved",
		}
	}
	index := NewIndex()
	index.SetIndexForTest(api.IndexData{Definitions: definitions})
	index.Resize(Size{Width: 100, Height: 18})
	index.Focus("definition", "prompt:18")
	index.setFocus(indexFocusDetail)
	index.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	want := index.CaptureLocation()

	definitions[17].Description += " current-refresh-marker"
	refreshed := append([]api.ProjectDefinition(nil), definitions...)
	index.SetIndexForTest(api.IndexData{Definitions: refreshed})
	index.definitions.Select("prompt:02")
	index.syncDetail()
	index.setFocus(indexFocusDefinitions)
	index.RestoreLocation(want)

	got := index.CaptureLocation()
	if got.FocusedPane != want.FocusedPane || got.SelectedIDs["definition"] != want.SelectedIDs["definition"] {
		t.Fatalf("restored Index identity = %#v, want %#v", got, want)
	}
	if got.Anchors["definitions"] != want.Anchors["definitions"] || got.Anchors["detail"] != want.Anchors["detail"] {
		t.Fatalf("restored Index anchors = %#v, want %#v", got.Anchors, want.Anchors)
	}
	if view := stripANSI(index.View(Size{})); !strings.Contains(view, "current-refresh-marker") {
		t.Fatalf("restored location used stale document data:\n%s", view)
	}
}
