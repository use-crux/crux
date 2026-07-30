package shell

import (
	"strings"
	"testing"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/x/ansi"
)

func TestBreadcrumbIsExactlyOneContentRowAtSupportedWidths(t *testing.T) {
	path := []string{
		"demo-project:customer-support-agent",
		"runs",
		"run run_demo_shared-prefix_unique-tail",
	}
	right := "local localhost:4472  ·  ingest token .crux/devtools/ingest-token  ·  dev  ·  project · demo-project  ·  feature/a-very-long-branch @ deadbee *"

	for width := 60; width <= 200; width++ {
		got := Breadcrumb(width, path, right)
		lines := strings.Split(got, "\n")
		if len(lines) != 2 {
			t.Fatalf("width %d rendered %d breadcrumb rows, want content + divider:\n%s", width, len(lines), ansi.Strip(got))
		}
		for i, line := range lines {
			if gotWidth := lipgloss.Width(line); gotWidth != width {
				t.Fatalf("width %d line %d rendered %d cells:\n%s", width, i, gotWidth, ansi.Strip(got))
			}
		}
	}
}

func TestBreadcrumbDropsRightmostMetaSegmentsWhole(t *testing.T) {
	got := ansi.Strip(Breadcrumb(60, []string{"overview"}, "first-metadata  ·  second-metadata  ·  third-metadata"))
	first, _, _ := strings.Cut(got, "\n")
	if !strings.Contains(first, "second-metadata") || strings.Contains(first, "third-metadata") {
		t.Fatalf("breadcrumb did not drop the rightmost metadata segment first: %q", first)
	}
	if strings.Contains(first, "…") {
		t.Fatalf("breadcrumb partially truncated metadata instead of dropping whole segments: %q", first)
	}
}

func TestBreadcrumbAccentsOnlyActiveTail(t *testing.T) {
	got := Breadcrumb(60, []string{"runs", "Refund answer"}, "")
	tealRun := Teal.Render("runs")
	tealTail := Teal.Render("Refund answer")
	if strings.Contains(got, tealRun) {
		t.Fatalf("breadcrumb accented parent segment:\n%q", got)
	}
	if !strings.Contains(got, tealTail) {
		t.Fatalf("breadcrumb did not accent active tail:\n%q", got)
	}
}

func TestFrameScreenKeepsSingleRuleBeforeLeadingPane(t *testing.T) {
	width := 60
	screen := horizontalBorderDim(width) + "\ncontent"
	framed := ansi.Strip(FrameScreen(width, Breadcrumb(width, []string{"runs"}, ""), screen))

	if got := strings.Count(framed, strings.Repeat("─", width)); got != 1 {
		t.Fatalf("framed screen has %d full-width rules before content, want 1:\n%s", got, framed)
	}
}

func TestFrameScreenRecognizesSegmentedPaneRule(t *testing.T) {
	width := 60
	screen := horizontalBorderDim(29) + "│" + horizontalBorderDim(30) + "\ncontent"
	framed := ansi.Strip(FrameScreen(width, Breadcrumb(width, []string{"runs"}, ""), screen))
	lines := strings.Split(framed, "\n")

	if len(lines) < 2 || lines[1] != strings.Repeat("─", 29)+"│"+strings.Repeat("─", 30) {
		t.Fatalf("segmented pane rule did not replace breadcrumb rule:\n%s", framed)
	}
}
