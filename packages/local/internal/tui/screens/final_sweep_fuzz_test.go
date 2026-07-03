package screens

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestFinalSweepAllScreensFuzzResize(t *testing.T) {
	overview, overviewNow := fixtureOverview()
	runs, runsNow := fixtureRuns()
	insights, insightsNow := fixtureInsights()
	experiments, experimentsNow := fixtureExperiments(t)
	datasets := fixtureDatasetsScreen(t)
	cassettes, feedback, baselines, reviewNow := fixtureQualityReview(t)
	index := NewIndex()
	index.SetIndexForTest(sampleIndex())

	cases := []struct {
		name string
		now  time.Time
		view func(Size) string
	}{
		{"overview", overviewNow, overview.View},
		{"insights", insightsNow, insights.View},
		{"runs", runsNow, runs.View},
		{"experiments", experimentsNow, experiments.View},
		{"datasets", overviewNow, datasets.View},
		{"baselines", reviewNow, baselines.View},
		{"feedback", reviewNow, feedback.View},
		{"cassettes", reviewNow, cassettes.View},
		{"index", overviewNow, index.View},
	}

	prevNow := relTimeNow
	defer func() { relTimeNow = prevNow }()

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			relTimeNow = func() time.Time { return tc.now }
			uitest.FuzzResize(t, func(width, height int) string {
				return tc.view(Size{Width: width, Height: height})
			})
		})
	}
}
