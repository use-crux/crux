package screens

import (
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
)

func TestCassettesPhase13RendersStatsAndReadOnlyDrift(t *testing.T) {
	screen := NewCassettes()
	screen.loaded = true
	screen.items = []api.QualityCassetteFileRecord{
		{
			Name:       "fixtures/triage",
			Path:       ".crux/quality/cassettes/fixtures/triage.json",
			RecordedAt: "2026-07-02T10:00:00Z",
			SdkVersion: "0.7.0",
			Models:     []string{"gpt-5"},
			EntryCount: 98,
			Stale:      true,
			SizeBytes:  819200,
		},
	}
	screen.selectedPath = screen.items[0].Path

	out := stripANSI(screen.View(Size{Width: 120, Height: 32}))
	normalized := strings.ToLower(out)
	for _, want := range []string{
		"entries",
		"hit %",
		"missing",
		"mismatch",
		"DRIFT",
		"fixtures/triage",
	} {
		if !strings.Contains(normalized, strings.ToLower(want)) {
			t.Fatalf("Cassettes view missing %q:\n%s", want, out)
		}
	}

	hints := ""
	for _, bind := range screen.Keybinds() {
		hints += bind.Key + " " + bind.Label + " "
	}
	for _, unsupported := range []string{"re-record", "play", "prune", "diff"} {
		if strings.Contains(hints, unsupported) {
			t.Fatalf("unsupported cassette action %q is advertised in %q", unsupported, hints)
		}
	}
}
