package kit

import (
	"testing"

	"github.com/charmbracelet/x/ansi"
)

func TestSparklineUsesBlockRampAndHidesNonTrends(t *testing.T) {
	if got := ansi.Strip(Sparkline([]float64{0, 1, 2, 3}, 8, adapterPalette.Teal)); got != "▁▃▆█" {
		t.Fatalf("Sparkline ramp = %q, want %q", got, "▁▃▆█")
	}
	for name, values := range map[string][]float64{
		"short": {1, 2, 3},
		"flat":  {2, 2, 2, 2},
	} {
		if got := Sparkline(values, 8, adapterPalette.Teal); got != "" {
			t.Fatalf("%s Sparkline = %q, want hidden", name, got)
		}
	}
}

func TestSparklineKeepsNewestVisibleValues(t *testing.T) {
	got := ansi.Strip(Sparkline([]float64{0, 100, 2, 3, 4, 5}, 4, adapterPalette.Teal))
	if got != "▁▃▆█" {
		t.Fatalf("width-limited Sparkline = %q, want newest four values", got)
	}
}
