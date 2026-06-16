package output

import (
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
)

func TestPadRightASCIIUnchanged(t *testing.T) {
	// Regression guard: pure ASCII padding must match byte-length behavior.
	if got := padRight("abc", 5); got != "abc  " {
		t.Errorf("padRight(\"abc\", 5) = %q, want %q", got, "abc  ")
	}
	if got := padRight("abcdef", 3); got != "abcdef" {
		t.Errorf("padRight should not truncate when already wider, got %q", got)
	}
}

// TestTableWidthAlignment verifies that a CJK cell and an ANSI-styled cell align
// to the same column boundary as a plain ASCII cell — i.e. every rendered row
// line has the same display width (lipgloss.Width), proving width-aware padding.
func TestTableWidthAlignment(t *testing.T) {
	ansiCell := "\x1b[31mdef\x1b[0m" // display width 3, byte length 12
	table := &Table{
		Rows: [][]string{
			{"abc", "1"},    // plain ASCII, width 3
			{"中文", "2"},     // CJK, width 4
			{ansiCell, "3"}, // ANSI-styled, width 3
		},
	}
	rendered := table.Render()

	var widths []int
	for _, line := range strings.Split(strings.TrimRight(rendered, "\n"), "\n") {
		widths = append(widths, lipgloss.Width(line))
	}
	if len(widths) != 3 {
		t.Fatalf("expected 3 row lines, got %d (%q)", len(widths), rendered)
	}
	for i, w := range widths {
		if w != widths[0] {
			t.Errorf("row %d display width = %d, want %d (all rows must align)", i, w, widths[0])
		}
	}

	// Sanity: the first column padded to the widest cell (CJK "中文" = 4 cols).
	firstCol := strings.SplitN(strings.Split(rendered, "\n")[1], "  ", 2)[0]
	if lipgloss.Width(firstCol) != 4 {
		t.Errorf("CJK cell column width = %d, want 4", lipgloss.Width(firstCol))
	}
}
