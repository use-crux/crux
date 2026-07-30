package screens

import (
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestInsightsFuzzResize(t *testing.T) {
	insights, now := fixtureInsights()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	uitest.FuzzResize(t, func(width, height int) string {
		return insights.View(Size{Width: width, Height: height})
	})
}

func TestInsightsGoldens(t *testing.T) {
	insights, now := fixtureInsights()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name   string
		width  int
		height int
		empty  bool
	}{
		{"insights-160x45", 160, 45, false},
		{"insights-100x30", 100, 30, false},
		{"insights-70x24", 70, 24, false},
		{"insights-empty", 100, 30, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			screen := insights
			if tc.empty {
				screen = NewInsights()
				screen.loaded = true
			}
			uitest.Golden(t, tc.name, screen.View(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func TestInsightsLayoutSingleShowsOnePane(t *testing.T) {
	insights, now := fixtureInsights()
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	out := stripANSI(insights.View(Size{Width: 70, Height: 24}))
	if strings.Contains(out, "Diagnosis") || strings.Contains(out, "PROPOSED FIX") {
		t.Fatalf("single-column Insights should show only the focused list pane by default:\n%s", out)
	}
	if strings.Contains(out, "│") {
		t.Fatalf("single-column Insights should not squeeze multiple panes into a split layout:\n%s", out)
	}
	if !strings.Contains(out, "Insights") || !strings.Contains(out, "docs_agent loops on retrieval") {
		t.Fatalf("single-column Insights lost the list pane:\n%s", out)
	}
	if strings.Contains(out, "INS-014") {
		t.Fatalf("single-column Insights list still spends title width on the insight id:\n%s", out)
	}
}

func TestInsightsListRowsPrioritizeWholeWordTitles(t *testing.T) {
	insights, _ := fixtureInsights()
	ins := insights.items[0]
	ins.InsightID = "run-suspicious-id"
	ins.Title = "Run is waiting on a human approval"

	line, _ := insights.renderListRow(ins, 44, true)
	plain := ansi.Strip(line)
	if strings.Contains(plain, shortID(ins.InsightID, 8)) {
		t.Fatalf("list row spends title width on insight id: %q", plain)
	}
	if !strings.Contains(plain, "Run is waiting") {
		t.Fatalf("list row does not prioritize the human title: %q", plain)
	}
	if strings.Contains(plain, "waiti…") {
		t.Fatalf("list row truncated the title mid-word: %q", plain)
	}
}

func TestInsightsEmptyStateRendersAtEverySupportedWidth(t *testing.T) {
	for _, width := range []int{60, 70, 100, 160} {
		screen := NewInsights()
		screen.loaded = true
		view := stripANSI(screen.View(Size{Width: width, Height: 24}))
		if !strings.Contains(view, "No insights yet") || !strings.Contains(view, "crux eval") {
			t.Fatalf("width %d omitted actionable empty state:\n%s", width, view)
		}
	}
}

func fixtureInsights() (*Insights, time.Time) {
	client := uitest.NewFixtureClient()
	insights, _ := client.Insights(nil)
	screen := NewInsights()
	screen.items = insights
	if len(insights) > 0 {
		screen.selectedID = insights[0].InsightID
	}
	screen.loaded = true
	return screen, client.Now
}
