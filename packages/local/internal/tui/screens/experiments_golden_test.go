package screens

import (
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/tui/uitest"
)

func TestExperimentsRunningFixtureRendersProgressStrip(t *testing.T) {
	screen, now := fixtureExperiments(t)
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	out := stripANSI(screen.View(Size{Width: 160, Height: 45}))
	for _, want := range []string{
		"running",
		"3/4 cases x 4 variants",
		"VARIANTS x METRICS",
		"maxIter+dedupe is promotion-ready",
		"VARIANT CONFIG DIFF",
	} {
		if !strings.Contains(out, want) {
			t.Fatalf("Experiments fixture view missing %q:\n%s", want, out)
		}
	}
}

func TestExperimentsFuzzResize(t *testing.T) {
	screen, now := fixtureExperiments(t)
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	uitest.FuzzResize(t, func(width, height int) string {
		return screen.View(Size{Width: width, Height: height})
	})
}

func TestExperimentsGoldens(t *testing.T) {
	screen, now := fixtureExperiments(t)
	prevNow := relTimeNow
	relTimeNow = func() time.Time { return now }
	defer func() { relTimeNow = prevNow }()

	cases := []struct {
		name   string
		width  int
		height int
		empty  bool
	}{
		{"experiments-160x45", 160, 45, false},
		{"experiments-100x30", 100, 30, false},
		{"experiments-70x24", 70, 24, false},
		{"experiments-empty", 100, 30, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := screen
			if tc.empty {
				got = NewExperiments()
				got.loaded = true
			}
			uitest.Golden(t, tc.name, got.View(Size{Width: tc.width, Height: tc.height}))
		})
	}
}

func fixtureExperiments(t *testing.T) (*Experiments, time.Time) {
	t.Helper()

	client := uitest.NewFixtureClient()
	items, err := client.ExperimentSummaries(nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) == 0 {
		t.Fatal("fixture client returned no experiments")
	}
	detail, found, err := client.ExperimentDetail(nil, items[0].ExperimentID)
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatalf("fixture client has no detail for %s", items[0].ExperimentID)
	}

	screen := NewExperiments()
	screen.applySummaries(items)
	screen.detail = &detail
	screen.loaded = true
	return screen, client.Now
}
