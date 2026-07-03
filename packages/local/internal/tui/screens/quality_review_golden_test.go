package screens

import (
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestPhase13ScreensFuzzResize(t *testing.T) {
	cassettes, feedback, baselines, now := fixtureQualityReview(t)
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name string
		view func(Size) string
	}{
		{"cassettes", cassettes.View},
		{"feedback", feedback.View},
		{"baselines", baselines.View},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uitest.FuzzResize(t, func(width, height int) string {
				return tc.view(Size{Width: width, Height: height})
			})
		})
	}
}

func TestPhase13ScreenGoldens(t *testing.T) {
	cassettes, feedback, baselines, now := fixtureQualityReview(t)
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name   string
		width  int
		height int
		view   func(Size) string
	}{
		{"cassettes-160x45", 160, 45, cassettes.View},
		{"cassettes-100x30", 100, 30, cassettes.View},
		{"cassettes-70x24", 70, 24, cassettes.View},
		{"feedback-160x45", 160, 45, feedback.View},
		{"feedback-100x30", 100, 30, feedback.View},
		{"feedback-70x24", 70, 24, feedback.View},
		{"baselines-160x45", 160, 45, baselines.View},
		{"baselines-100x30", 100, 30, baselines.View},
		{"baselines-70x24", 70, 24, baselines.View},
		{"cassettes-empty", 100, 30, func(size Size) string {
			screen := NewCassettes()
			screen.loaded = true
			return screen.View(size)
		}},
		{"feedback-empty", 100, 30, func(size Size) string {
			screen := NewFeedback()
			screen.loaded = true
			return screen.View(size)
		}},
		{"baselines-empty", 100, 30, func(size Size) string {
			screen := NewBaselines()
			screen.loaded = true
			return screen.View(size)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			uitest.Golden(t, tc.name, tc.view(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func fixtureQualityReview(t *testing.T) (*Cassettes, *Feedback, *Baselines, time.Time) {
	t.Helper()

	client := uitest.NewFixtureClient()

	cassettes := NewCassettes()
	cassetteItems, err := client.CassetteFiles(nil)
	if err != nil {
		t.Fatal(err)
	}
	cassettes.items = cassetteItems
	cassettes.loaded = true
	if len(cassetteItems) > 0 {
		cassettes.selectedPath = cassetteItems[0].Path
	}

	feedback := NewFeedback()
	feedbackItems, err := client.Feedback(nil)
	if err != nil {
		t.Fatal(err)
	}
	feedback.items = feedbackItems
	feedback.loaded = true
	if len(feedbackItems) > 0 {
		feedback.selectedID = feedbackItems[0].ID
	}

	baselines := NewBaselines()
	baselineItems, err := client.PromotedBaselines(nil)
	if err != nil {
		t.Fatal(err)
	}
	baselines.items = baselineItems
	baselines.loaded = true
	if len(baselineItems) > 0 {
		baselines.selectedID = baselineItems[0].BaselineID
	}

	return cassettes, feedback, baselines, client.Now
}
