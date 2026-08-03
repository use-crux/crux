package screens

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func TestRunsSpanDetailScrollsWhenFocusedAndShowsPosition(t *testing.T) {
	runs := newLongSpanRuns()
	before := stripANSI(renderSpanDetailForTest(runs, 40, 10))
	position := runs.spanDocument.Position()
	if position.TotalLines <= 7 {
		t.Fatalf("document lines = %d, want more than the seven-line body viewport", position.TotalLines)
	}
	if want := fmt.Sprintf("%d-%d/%d", position.FirstLine, position.LastLine, position.TotalLines); !strings.Contains(before, want) {
		t.Fatalf("detail header missing position %q:\n%s", want, before)
	}

	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	after := stripANSI(renderSpanDetailForTest(runs, 40, 10))
	if got := runs.spanDocument.Position().Offset; got != 1 {
		t.Fatalf("document offset after j = %d, want 1", got)
	}
	if after == before {
		t.Fatal("focused detail did not visibly scroll")
	}
}

func TestRunsSpanDetailRoutesPageHomeEndOnlyWhileFocused(t *testing.T) {
	runs := newLongSpanRuns()
	renderSpanDetailForTest(runs, 40, 10)

	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	if got := runs.spanDocument.Position().Offset; got != 7 {
		t.Fatalf("offset after page down = %d, want one seven-line page", got)
	}
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyEnd}, nil)
	position := runs.spanDocument.Position()
	if got, want := position.Offset, position.TotalLines-7; got != want {
		t.Fatalf("offset after end = %d, want final page offset %d", got, want)
	}
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyHome}, nil)
	if got := runs.spanDocument.Position().Offset; got != 0 {
		t.Fatalf("offset after home = %d, want 0", got)
	}

	runs.setFocus(focusWaterfall)
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)
	if got := runs.spanDocument.Position().Offset; got != 0 {
		t.Fatalf("unfocused document offset = %d, want 0", got)
	}
}

func TestRunsSpanDetailRoutesSharedDocumentAliases(t *testing.T) {
	runs := newLongSpanRuns()
	renderSpanDetailForTest(runs, 40, 10)

	runs.Update(testContext, tea.KeyPressMsg{Code: 'd', Mod: tea.ModCtrl}, nil)
	if got := runs.spanDocument.Position().Offset; got != 7 {
		t.Fatalf("offset after ^d = %d, want one detail page", got)
	}
	runs.Update(testContext, tea.KeyPressMsg{Text: "G", Code: 'G'}, nil)
	position := runs.spanDocument.Position()
	if got, want := position.Offset, position.TotalLines-7; got != want {
		t.Fatalf("offset after G = %d, want %d", got, want)
	}
	runs.Update(testContext, tea.KeyPressMsg{Code: 'u', Mod: tea.ModCtrl}, nil)
	if got := runs.spanDocument.Position().Offset; got >= position.Offset {
		t.Fatalf("offset after ^u = %d, want before %d", got, position.Offset)
	}
	runs.Update(testContext, tea.KeyPressMsg{Text: "g", Code: 'g'}, nil)
	if got := runs.spanDocument.Position().Offset; got != 0 {
		t.Fatalf("offset after g = %d, want top", got)
	}

	help := strings.Join(keybindLabels(runs.Keybinds()), " · ")
	for _, want := range []string{"pgdn/^d", "pgup/^u", "home/g", "end/G"} {
		if !strings.Contains(help, want) {
			t.Fatalf("run-detail help omitted %q: %s", want, help)
		}
	}
}

func keybindLabels(bindings []shell.Keybind) []string {
	labels := make([]string, 0, len(bindings))
	for _, binding := range bindings {
		labels = append(labels, binding.Key+" "+binding.Label)
	}
	return labels
}

func TestRunsResizeInitializesDocumentBeforeInput(t *testing.T) {
	runs := newLongSpanRuns()
	runs.Resize(Size{Width: 40, Height: 10})

	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)

	if got := runs.spanDocument.Position().Offset; got != 7 {
		t.Fatalf("offset after resize-before-input page down = %d, want 7", got)
	}
}

func TestRunsResizeRestoresDocumentBoundsBeforeInput(t *testing.T) {
	runs := newLongSpanRuns()
	small := Size{Width: 70, Height: 17}
	large := Size{Width: 100, Height: 24}

	runs.Resize(small)
	runs.View(small)
	runs.Resize(large)
	runs.View(large)
	runs.Resize(small)
	runs.View(small)
	wantPage := runs.spanDocument.Position().LastLine
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyPgDown}, nil)

	if got := runs.spanDocument.Position().Offset; got != wantPage {
		t.Fatalf("offset after resized small view page down = %d, want page size %d", got, wantPage)
	}
}

func TestRunsResizeReflectsClampedDocumentPosition(t *testing.T) {
	runs := newLongSpanRuns()
	small := Size{Width: 70, Height: 17}
	large := Size{Width: 100, Height: 24}

	viewRunsForTest(runs, small)
	runs.Update(testContext, tea.KeyPressMsg{Code: tea.KeyEnd}, nil)
	endView := stripANSI(viewRunsForTest(runs, small))
	viewRunsForTest(runs, large) // clamps the end offset for the taller viewport
	runs.Resize(small)
	position := runs.spanDocument.Position()
	got := stripANSI(runs.View(small))
	want := fmt.Sprintf("%d-%d/%d", position.FirstLine, position.LastLine, position.TotalLines)

	if !strings.Contains(got, want) {
		t.Fatalf("resized small view omitted current clamped position %q:\n%s", want, got)
	}
	if got == endView {
		t.Fatal("returning to the small rectangle rendered stale end-position lines")
	}
}

func TestRunsSpanDetailNeverCrossesItsRenderingBounds(t *testing.T) {
	runs := newLongSpanRuns()
	for _, size := range []Size{{Width: 1, Height: 1}, {Width: 18, Height: 7}, {Width: 40, Height: 10}} {
		lines := strings.Split(renderSpanDetailForTest(runs, size.Width, size.Height), "\n")
		if len(lines) != size.Height {
			t.Fatalf("%dx%d detail line count = %d, want %d", size.Width, size.Height, len(lines), size.Height)
		}
		for i, line := range lines {
			if width := lipgloss.Width(line); width != size.Width {
				t.Fatalf("%dx%d line %d width = %d, want %d", size.Width, size.Height, i, width, size.Width)
			}
		}
	}
}

func TestRunsSpanDetailWrapsLongAttributeWithoutLosingContent(t *testing.T) {
	longValue := "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
	runs := NewRuns()
	setRunDiagnosisForTest(runs, runDiagnosisFixture{
		RunID:     "run-long-value",
		StartedAt: 1,
		Spans: []api.InspectRunSpan{{
			ID:         "span-long-value",
			Name:       "long value",
			Kind:       "tool",
			Op:         "tool.call",
			Attributes: map[string]string{"long_value": longValue},
		}},
	})
	selectSpanForTest(runs, "span-long-value")
	runs.setFocus(focusSpanDetail)
	renderSpanDetailForTest(runs, 24, 40)

	var compact strings.Builder
	for _, line := range runs.spanDocument.Render() {
		compact.WriteString(strings.ReplaceAll(stripANSI(line), " ", ""))
	}
	if got := compact.String(); !strings.Contains(got, longValue) {
		t.Fatalf("wrapped document lost long attribute value %q:\n%s", longValue, got)
	}
}

func newLongSpanRuns() *Runs {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-long"})
	selectRunForTest(runs, "run-long")
	attributes := make(map[string]string, 20)
	for i := range 20 {
		attributes[fmt.Sprintf("attribute.%02d", i)] = strings.Repeat(fmt.Sprintf("value-%02d", i), 4)
	}
	setRunDiagnosisForTest(runs, runDiagnosisFixture{
		RunID:     "run-long",
		StartedAt: 1,
		Spans: []api.InspectRunSpan{{
			ID:         "span-long",
			Name:       "long span",
			Kind:       "tool",
			Op:         "tool.call",
			Attributes: attributes,
		}},
	})
	selectSpanForTest(runs, "span-long")
	runs.setFocus(focusSpanDetail)
	return runs
}
