package screens

import (
	"fmt"
	"strings"
	"testing"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/observability"
)

func TestRunsHierarchyKeepsFocusedSelectionVisibleAndDetailScrollIndependent(t *testing.T) {
	runs := newScrollableHierarchyRuns()
	size := Size{Width: 100, Height: 7}
	runs.Resize(size)

	for range 6 {
		runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	}
	selected := runs.currentSpan()
	if selected == nil || selected.ID != "span-6" {
		t.Fatalf("selected span = %#v, want span-6", selected)
	}
	if got := stripANSI(runs.View(size)); !strings.Contains(got, "span row 6") {
		t.Fatalf("hierarchy did not keep selected span visible:\n%s", got)
	}

	runs.setFocus(focusSpanDetail)
	before := runs.spanDocument.Position().Offset
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	if got := runs.currentSpan(); got == nil || got.ID != "span-6" {
		t.Fatalf("detail scroll changed hierarchy selection to %#v", got)
	}
	if got := runs.spanDocument.Position().Offset; got != before+1 {
		t.Fatalf("detail offset after j = %d, want %d", got, before+1)
	}
}

func TestRunsHierarchyRefreshPreservesSelectedSpanIdentity(t *testing.T) {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-refresh", Revision: 1})
	selectRunForTest(runs, "run-refresh")
	setRunDetailForTest(runs, hierarchyDetail(1,
		hierarchyNode("span-a", "span A"),
		hierarchyNode("span-b", "span B"),
	))
	runs.Resize(Size{Width: 100, Height: 12})
	runs.setFocus(focusWaterfall)
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	runs.Update(testContext, tea.KeyPressMsg{Text: "j", Code: 'j'}, nil)
	if got := runs.currentSpan(); got == nil || got.ID != "span-b" {
		t.Fatalf("selected span before refresh = %#v, want span-b", got)
	}

	setRunDetailForTest(runs, hierarchyDetail(2,
		hierarchyNode("span-a", "span A"),
		hierarchyNode("span-x", "new sibling"),
		hierarchyNode("span-b", "span B refreshed"),
	))
	selected, _, ok := runs.spanList.Selected()
	if !ok || selected.ID != "span-b" || runs.spanList.Position().Total != 4 {
		t.Fatalf("pane after refresh = selected %#v, position %#v; want span-b among four current rows", selected, runs.spanList.Position())
	}
	view := stripANSI(viewRunsForTest(runs, Size{Width: 100, Height: 12}))
	if !lineContaining(view, "span B refreshed", "▌") {
		t.Fatalf("refresh did not retain the selection marker on span-b:\n%s", view)
	}
}

func hierarchyDetail(revision int64, children ...api.ObservabilityRunDetailNode) api.ObservabilityRunDetail {
	return api.ObservabilityRunDetail{
		Run: api.ObservabilityRunSummary{RunID: "run-refresh", Revision: revision},
		Root: api.ObservabilityRunDetailNode{
			SpanSummary: api.ObservabilitySpanSummary{SpanID: "span-root", RunID: "run-refresh"},
			ID:          "span:span-root",
			Display:     observability.RunDetailDisplay{Kind: "agent", Label: "root"},
			Children:    children,
		},
	}
}

func hierarchyNode(id, label string) api.ObservabilityRunDetailNode {
	return api.ObservabilityRunDetailNode{
		SpanSummary: api.ObservabilitySpanSummary{SpanID: id, RunID: "run-refresh"},
		ID:          "span:" + id,
		ParentID:    "span:span-root",
		Display:     observability.RunDetailDisplay{Kind: "tool", Label: label},
	}
}

func lineContaining(body string, values ...string) bool {
	for _, line := range strings.Split(body, "\n") {
		matches := true
		for _, value := range values {
			matches = matches && strings.Contains(line, value)
		}
		if matches {
			return true
		}
	}
	return false
}

func newScrollableHierarchyRuns() *Runs {
	runs := NewRuns()
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-hierarchy"})
	selectRunForTest(runs, "run-hierarchy")
	duration := 10.0
	spans := make([]api.InspectRunSpan, 8)
	for i := range spans {
		parentID := ""
		if i > 0 {
			parentID = "span-0"
		}
		spans[i] = api.InspectRunSpan{
			ID:         fmt.Sprintf("span-%d", i),
			ParentID:   parentID,
			Name:       fmt.Sprintf("span row %d", i),
			Primitive:  api.SpanPrimitiveTool,
			DurationMs: &duration,
			Attributes: map[string]string{
				"evidence": strings.Repeat(fmt.Sprintf("detail-%d ", i), 20),
			},
		}
	}
	runs.detail = &api.InspectRunDetailRecord{
		Run:   api.InspectRunRecord{TraceID: "run-hierarchy", DurationMs: &duration},
		Spans: spans,
	}
	selectSpanForTest(runs, spans[0].ID)
	runs.setFocus(focusWaterfall)
	return runs
}
