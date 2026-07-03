package screens

import (
	"strings"
	"testing"
	"time"

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
	if !strings.Contains(out, "Insights") || !strings.Contains(out, "INS-014") {
		t.Fatalf("single-column Insights lost the list pane:\n%s", out)
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
