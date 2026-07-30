package shell

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
)

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
