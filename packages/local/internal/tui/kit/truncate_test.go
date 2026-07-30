package kit

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
)

func TestFitMiddleNeverWraps(t *testing.T) {
	for width := 1; width <= 100; width++ {
		got := FitMiddle(width, "▸ Runs", "  · Last 1h", "sort: time ↓", "…")
		if strings.Contains(got, "\n") {
			t.Fatalf("width %d introduced a newline: %q", width, got)
		}
		if gotWidth := lipgloss.Width(got); gotWidth > width {
			t.Fatalf("width %d rendered %d cells: %q", width, gotWidth, got)
		}
	}
}

func TestTruncateMiddlePreservesDistinguishingTail(t *testing.T) {
	got := TruncateMiddle("run_demo_shared-prefix_unique-tail", 18, "…")
	if got != "run_demo_…que-tail" {
		t.Fatalf("TruncateMiddle() = %q", got)
	}
	if width := lipgloss.Width(got); width != 18 {
		t.Fatalf("TruncateMiddle() width = %d, want 18", width)
	}
}

func TestFitMarksANSIStyledClipping(t *testing.T) {
	got := Fit(lipgloss.NewStyle().Bold(true).Render("long body value"), 8, "…")
	if !strings.Contains(got, "…") {
		t.Fatalf("Fit() hid clipping: %q", got)
	}
	if width := lipgloss.Width(got); width != 8 {
		t.Fatalf("Fit() width = %d, want 8", width)
	}
}
