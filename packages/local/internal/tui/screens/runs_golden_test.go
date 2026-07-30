package screens

import (
	"strings"
	"testing"
	"time"

	tea "charm.land/bubbletea/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestRunsFuzzResize(t *testing.T) {
	runs, now := fixtureRuns()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	uitest.FuzzResize(t, func(width, height int) string {
		return viewRunsForTest(runs, Size{Width: width, Height: height})
	})
}

func TestRunsGoldens(t *testing.T) {
	runs, now := fixtureRuns()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name   string
		width  int
		height int
		empty  bool
	}{
		{"runs-160x45", 160, 45, false},
		{"runs-100x30", 100, 30, false},
		{"runs-70x24", 70, 24, false},
		{"runs-empty", 100, 30, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			screen := runs
			if tc.empty {
				screen = NewRuns()
				setRunsForTest(screen)
			}
			uitest.Golden(t, tc.name, viewRunsForTest(screen, Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func TestRunsScrollableDetailGolden(t *testing.T) {
	runs, now := fixtureRuns()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()
	runs.setFocus(focusSpanDetail)

	uitest.Golden(t, "runs-detail-scroll-160x18", viewRunsForTest(runs, Size{Width: 160, Height: 18}))
}

func fixtureRuns() (*Runs, time.Time) {
	client := uitest.NewFixtureClient()
	runs, _ := client.Runs(nil)
	detail, _, _ := client.ObservabilityRunDetail(nil, inspectOperationID(runs[0]))
	screen := NewRuns()
	summaries := make([]api.ObservabilityRunSummary, len(runs))
	for index, run := range runs {
		summaries[index] = observabilityRunSummaryForTest(run)
	}
	setRunsForTest(screen, summaries...)
	setRunDetailForTest(screen, detail)
	selectRunForTest(screen, inspectOperationID(runs[0]))
	selectSpanForTest(screen, "retrieve")
	screen.runList.SetItems(summaries)
	return screen, client.Now
}

func TestRunsStatusFilterLimitsVisibleRows(t *testing.T) {
	screen := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "error-1", Name: "failed docs run", Status: "error"},
		{RunID: "ok-1", Name: "successful docs run", Status: "ok"},
		{RunID: "run-1", Name: "active docs run", Status: "running"},
	}
	setRunsForTest(screen, values...)
	selectRunForTest(screen, "error-1")
	screen.runList.SetItems(values)

	screen.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "f", Code: 'f'}), nil)
	out := stripANSI(viewRunsForTest(screen, Size{Width: 100, Height: 24}))

	if !strings.Contains(out, "failed docs run") {
		t.Fatalf("failed filter lost the error-status row:\n%s", out)
	}
	for _, hidden := range []string{"successful docs run", "active docs run"} {
		if strings.Contains(out, hidden) {
			t.Fatalf("status filter rendered hidden %q row:\n%s", hidden, out)
		}
	}
}

func TestRunsTextFilterLimitsVisibleRows(t *testing.T) {
	screen := NewRuns()
	values := []api.ObservabilityRunSummary{
		{RunID: "docs-000", Name: "docs_agent", Status: "failed"},
		{RunID: "triage-0", Name: "triage", Status: "passed"},
	}
	setRunsForTest(screen, values...)
	selectRunForTest(screen, "docs-000")
	screen.runList.SetItems(values)

	screen.Update(testContext, tea.KeyPressMsg(tea.Key{Text: "/", Code: '/'}), nil)
	for _, r := range "triage" {
		screen.Update(testContext, tea.KeyPressMsg(tea.Key{Text: string(r), Code: r}), nil)
	}
	screen.Update(testContext, tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter}), nil)

	out := stripANSI(viewRunsForTest(screen, Size{Width: 100, Height: 24}))
	if strings.Contains(out, "docs_agent") {
		t.Fatalf("text filter rendered hidden docs row:\n%s", out)
	}
	if !strings.Contains(out, "triage") {
		t.Fatalf("text filter lost matching triage row:\n%s", out)
	}
}

func TestRunsListRowsPreferDisplayNameAndPreserveFallbackIDTail(t *testing.T) {
	screen := NewRuns()
	named := api.ObservabilityRunSummary{
		RunID: "run_demo_shared_prefix_hidden_id",
		Name:  "Invoice summary · grounded",
	}
	first, _ := screen.renderRunRow(named, 26, false)
	first = stripANSI(first)
	if !strings.Contains(first, "Invoice") || !strings.Contains(first, "grounded") || strings.Contains(first, "run_demo") {
		t.Fatalf("named run row did not prioritize display identity:\n%s", first)
	}

	unnamed := api.ObservabilityRunSummary{RunID: "run_demo_shared_prefix_distinguishing_tail"}
	first, _ = screen.renderRunRow(unnamed, 26, false)
	first = stripANSI(first)
	if !strings.Contains(first, "…") || !strings.Contains(first, "tail") {
		t.Fatalf("fallback run ID lost its distinguishing tail:\n%s", first)
	}
}

func TestRunsWaterfallCollapsesDuplicateGroups(t *testing.T) {
	screen := NewRuns()
	setRunsForTest(screen)
	duration := 10_000.0
	spanDuration := 100.0
	setRunDiagnosisForTest(screen, runDiagnosisFixture{
		RunID:      "run-dup",
		Name:       "docs_agent",
		DurationMs: duration,
		Spans: []api.InspectRunSpan{
			{ID: "root", Name: "docs_agent.run", Primitive: api.SpanPrimitiveAgent, DurationMs: &duration},
			{ID: "dup-1", ParentID: "root", Name: "rag.search \"typed prompts\"", Primitive: api.SpanPrimitiveTool, Duplicate: true, DuplicateOfSpanID: "search", StartedAt: 100, DurationMs: &spanDuration},
			{ID: "dup-2", ParentID: "root", Name: "rag.search \"typed prompts\"", Primitive: api.SpanPrimitiveTool, Duplicate: true, DuplicateOfSpanID: "search", StartedAt: 200, DurationMs: &spanDuration},
			{ID: "dup-3", ParentID: "root", Name: "rag.search \"typed prompts\"", Primitive: api.SpanPrimitiveTool, Duplicate: true, DuplicateOfSpanID: "search", StartedAt: 300, DurationMs: &spanDuration},
		},
	})
	selectRunForTest(screen, "run-dup")
	selectSpanForTest(screen, "dup-1")
	screen.focus = focusWaterfall

	collapsed := stripANSI(viewRunsForTest(screen, Size{Width: 140, Height: 28}))
	if !strings.Contains(collapsed, "+ 3 more") {
		t.Fatalf("collapsed waterfall missing duplicate summary:\n%s", collapsed)
	}
	if strings.Contains(collapsed, "dup-2") {
		t.Fatalf("collapsed waterfall rendered a hidden duplicate id:\n%s", collapsed)
	}

	screen.Update(testContext, tea.KeyPressMsg(tea.Key{Code: tea.KeyEnter}), nil)
	expanded := stripANSI(viewRunsForTest(screen, Size{Width: 140, Height: 28}))
	if strings.Contains(expanded, "+ 3 more") {
		t.Fatalf("expanded waterfall still rendered duplicate summary:\n%s", expanded)
	}
}
