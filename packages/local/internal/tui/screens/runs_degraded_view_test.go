package screens

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/bridge"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

type failingRunsViewClient struct {
	*uitest.FixtureClient
	listErr   error
	detailErr error
}

func (c *failingRunsViewClient) ObservabilityRunsPage(context.Context) (api.ObservabilityRunsPage, error) {
	return api.ObservabilityRunsPage{}, c.listErr
}

func (c *failingRunsViewClient) ObservabilityRunDetail(context.Context, string) (api.ObservabilityRunDetail, bool, error) {
	return api.ObservabilityRunDetail{}, false, c.detailErr
}

func TestRunsListRefreshFailureIsVisibleWithLastGoodRows(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 140, Height: 30})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	client := &failingRunsViewClient{FixtureClient: uitest.NewFixtureClient(), listErr: errors.New("list down")}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsListResource: 1,
	}), client)

	view := strings.ToLower(stripANSI(runs.View(Size{})))
	for _, want := range []string{"degraded", "list down", "retained run"} {
		if !strings.Contains(view, want) {
			t.Fatalf("degraded Runs list omitted %q while retaining rows:\n%s", want, view)
		}
	}
}

func TestRunsDetailRefreshFailureIsVisibleWithLastGoodDiagnosis(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 140, Height: 30})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"},
		Root: api.ObservabilityRunDetailNode{ID: "retained-root"},
	})
	client := &failingRunsViewClient{FixtureClient: uitest.NewFixtureClient(), detailErr: errors.New("detail down")}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsDetailResource("run-a"): 1,
	}), client)

	view := strings.ToLower(stripANSI(runs.View(Size{})))
	for _, want := range []string{"degraded", "detail down", "run run-a"} {
		if !strings.Contains(view, want) {
			t.Fatalf("degraded Runs detail omitted %q while retaining diagnosis:\n%s", want, view)
		}
	}
}

func TestRunsDegradedStatusSanitizesTerminalControlsAndStaysBounded(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 70, Height: 24})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	client := &failingRunsViewClient{
		FixtureClient: uitest.NewFixtureClient(),
		listErr:       errors.New("\x1b[31mworker down\x1b[0m\n\x1b]8;;https://example.invalid\x07unsafe"),
	}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsListResource: 1,
	}), client)

	view := runs.View(Size{})
	if strings.Contains(view, "\x1b]8;;https://example.invalid") {
		t.Fatalf("degraded status retained an authored OSC sequence:\n%s", view)
	}
	for _, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("degraded status line width = %d, want <= 70:\n%s", width, view)
		}
	}
}

func TestRunsInitialFailureSanitizesTerminalControlsAndStaysBounded(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 70, Height: 24})
	client := &failingRunsViewClient{
		FixtureClient: uitest.NewFixtureClient(),
		listErr:       errors.New("\x1b[31mworker down\x1b[0m\n\x1b]8;;https://example.invalid\x07unsafe"),
	}

	applyRunsBatchForTest(t, runs, runs.Init(testContext, client), client)

	view := runs.View(Size{})
	if strings.Contains(view, "\x1b]8;;https://example.invalid") {
		t.Fatalf("failed status retained an authored OSC sequence:\n%s", view)
	}
	for _, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("failed status line width = %d, want <= 70:\n%s", width, view)
		}
	}
}

func TestRunsInitialDetailFailureSanitizesTerminalControlsAndStaysBounded(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 70, Height: 24})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	selectRunForTest(runs, "run-a")
	runs.setFocus(focusWaterfall)
	client := &failingRunsViewClient{
		FixtureClient: uitest.NewFixtureClient(),
		detailErr:     errors.New("\x1b[31mdetail down\x1b[0m\n\x1b]8;;https://example.invalid\x07unsafe"),
	}

	applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsDetailResource("run-a"): 1,
	}), client)

	view := runs.View(Size{})
	if strings.Contains(view, "\x1b]8;;https://example.invalid") {
		t.Fatalf("failed detail status retained an authored OSC sequence:\n%s", view)
	}
	for _, line := range strings.Split(view, "\n") {
		if width := lipgloss.Width(line); width > 70 {
			t.Fatalf("failed detail line width = %d, want <= 70:\n%s", width, view)
		}
	}
}

func TestRunsListRefreshShowsStatusWithoutHidingQueryOrRows(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 70, Height: 24})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	runs.runQuery = "retained"
	client := uitest.NewFixtureClient()

	_ = runs.Refresh(testContext, client, bridge.Invalidations{bridge.RunsListResource: 1})

	view := strings.ToLower(stripANSI(runs.View(Size{})))
	for _, want := range []string{"refreshing", "/retained", "retained run"} {
		if !strings.Contains(view, want) {
			t.Fatalf("refreshing Runs list omitted %q:\n%s", want, view)
		}
	}
}

func TestRunsDetailRefreshShowsStatusWithLastGoodDiagnosis(t *testing.T) {
	runs := NewRuns()
	runs.Resize(Size{Width: 140, Height: 30})
	setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
	selectRunForTest(runs, "run-a")
	setRunDetailForTest(runs, api.ObservabilityRunDetail{
		Run:  api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"},
		Root: api.ObservabilityRunDetailNode{ID: "retained-root"},
	})
	client := uitest.NewFixtureClient()

	_ = runs.Refresh(testContext, client, bridge.Invalidations{
		bridge.RunsDetailResource("run-a"): 1,
	})

	view := strings.ToLower(stripANSI(runs.View(Size{})))
	for _, want := range []string{"refreshing", "run run-a"} {
		if !strings.Contains(view, want) {
			t.Fatalf("refreshing Runs detail omitted %q:\n%s", want, view)
		}
	}
}

func TestRunsFocusedDetailShowsLifecycleStatusAtNarrowAndMediumWidths(t *testing.T) {
	for _, size := range []Size{{Width: 70, Height: 24}, {Width: 100, Height: 30}} {
		t.Run(fmt.Sprintf("%dx%d", size.Width, size.Height), func(t *testing.T) {
			runs := NewRuns()
			runs.Resize(size)
			setRunsForTest(runs, api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"})
			selectRunForTest(runs, "run-a")
			setRunDetailForTest(runs, api.ObservabilityRunDetail{
				Run: api.ObservabilityRunSummary{RunID: "run-a", Name: "retained run"},
				Root: api.ObservabilityRunDetailNode{
					ID: "retained-root",
					SpanSummary: api.ObservabilitySpanSummary{
						SpanID:    "span-a",
						Name:      "retained span",
						Family:    "agent",
						Primitive: "agent.run",
					},
				},
			})
			runs.setFocus(focusSpanDetail)
			client := &failingRunsViewClient{FixtureClient: uitest.NewFixtureClient(), detailErr: errors.New("detail down")}

			applyRunsBatchForTest(t, runs, runs.Refresh(testContext, client, bridge.Invalidations{
				bridge.RunsDetailResource("run-a"): 1,
			}), client)

			view := strings.ToLower(stripANSI(runs.View(Size{})))
			for _, want := range []string{"degraded", "detail down", "retained span"} {
				if !strings.Contains(view, want) {
					t.Fatalf("focused detail omitted %q at %dx%d:\n%s", want, size.Width, size.Height, view)
				}
			}
		})
	}
}
